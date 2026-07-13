import { Inject, Injectable, Logger } from '@nestjs/common'
import { parseEnv } from '@hrobot/config'
import { Role } from '@hrobot/shared'

type FetchFn = typeof fetch

/**
 * Keycloak Admin API client for the UŻYTKOWNICY (user invite + RBAC) dual-write flows.
 *
 * Pattern (admin-token acquisition, endpoint shapes, 409-tolerant retries) is lifted directly
 * from the control-plane's inline implementation in
 * apps/control-plane/src/provisioning/steps/keycloak-setup.step.ts — see that file for the
 * source of truth. Do not invent endpoints here.
 *
 * Unlike the control-plane step (which provisions exactly one realm per job), tenant-runtime is
 * a single process serving every tenant's realm, so every public method here takes `realm`
 * (`hrobot-<slug>`) as an explicit first argument rather than assuming a fixed realm.
 *
 * SECURITY NOTE: this service performs no authorization of its own — it will happily
 * create/enable/disable users and grant/revoke realm roles for whichever `realm`/`kcId`/`role`
 * it is called with. It is safe today only because nothing outside tenant-runtime's internal
 * providers can reach it. The forthcoming 'uzytkownicy' controller (RBAC role management) MUST
 * enforce @Roles(Role.ADMIN_KLIENTA) + a DB active-role check BEFORE calling into this service,
 * and MUST return 403 before any Keycloak call — do not assume this class will reject a bad
 * caller for you.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name)
  private readonly keycloakUrl: string
  private readonly adminPassword: string

  constructor(@Inject('FETCH') private readonly fetchFn: FetchFn) {
    const env = parseEnv()
    this.keycloakUrl = env.KEYCLOAK_URL
    this.adminPassword = env.KEYCLOAK_ADMIN_CLIENT_SECRET
  }

  private async getAdminToken(): Promise<string> {
    const resp = await this.fetchFn(
      `${this.keycloakUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: 'admin',
          password: this.adminPassword,
        }).toString(),
      },
    )
    const data = (await resp.json()) as { access_token: string }
    return data.access_token
  }

  /**
   * `realm` (`hrobot-<slug>`) is always encoded before it hits the URL path — nothing upstream
   * of this service validates it, so an untrusted realm value containing '/', '..', or query
   * characters must not be able to redirect the admin-API call to a different KC endpoint.
   */
  private realmBase(realm: string): string {
    return `${this.keycloakUrl}/admin/realms/${encodeURIComponent(realm)}`
  }

  /**
   * Every dual-write path (grant/revoke/invite compensation) must be safe to retry, so every
   * write here tolerates a 409 Conflict (already exists / already assigned / already removed)
   * as success. Any other non-2xx fails loudly so the caller's compensation logic can react.
   */
  private async kc(token: string, url: string, init: RequestInit = {}): Promise<Response> {
    const r = await this.fetchFn(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    })
    if (!r.ok && r.status !== 409) {
      throw new Error(`keycloak ${init.method ?? 'GET'} ${url} -> ${r.status}`)
    }
    return r
  }

  /**
   * Creates the Keycloak user for a newly invited tenant user. User.id in the tenant DB is
   * app-supplied (randomUUID()), never the Keycloak id — the kcId returned here is what gets
   * stored as User.keycloakSub.
   *
   * KC ignores any id in the POST body, so the kcId MUST be read back: primarily from the
   * Location header of the 201 response; a 409 (already exists, e.g. a retried invite) carries
   * no Location, so this falls back to an exact-email lookup.
   */
  async createUser(realm: string, email: string): Promise<string> {
    const token = await this.getAdminToken()
    const base = this.realmBase(realm)

    const createResp = await this.kc(token, `${base}/users`, {
      method: 'POST',
      body: JSON.stringify({ username: email, email, enabled: true }),
    })

    let kcId = ((createResp.headers as { get(name: string): string | null }).get('Location') ?? '')
      .split('/')
      .pop() ?? ''

    if (!kcId) {
      const lookupResp = await this.kc(
        token,
        `${base}/users?email=${encodeURIComponent(email)}&exact=true`,
        { method: 'GET' },
      )
      const users = (await lookupResp.json()) as Array<{ id: string }>
      kcId = users[0]?.id ?? ''
    }

    if (!kcId) {
      throw new Error(`keycloak createUser: could not resolve kcId for ${email} in realm ${realm}`)
    }
    return kcId
  }

  /**
   * role-mappings/realm needs the full role representation, so the role is fetched first.
   *
   * `role` is typed against the tenant `Role` enum (not `string`) so nothing outside this file
   * can hand in an arbitrary path segment; it is additionally encodeURIComponent'd here (mirroring
   * the email param) as defense-in-depth against a future caller widening the type.
   */
  private async fetchRoleRepresentation(
    token: string,
    base: string,
    role: Role,
  ): Promise<{ id: string; name: string }> {
    const roleResp = await this.kc(token, `${base}/roles/${encodeURIComponent(role)}`, { method: 'GET' })
    return (await roleResp.json()) as { id: string; name: string }
  }

  async assignRealmRole(realm: string, kcId: string, role: Role): Promise<void> {
    const token = await this.getAdminToken()
    const base = this.realmBase(realm)
    const roleRep = await this.fetchRoleRepresentation(token, base, role)
    await this.kc(token, `${base}/users/${kcId}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify([{ id: roleRep.id, name: roleRep.name }]),
    })
  }

  async removeRealmRole(realm: string, kcId: string, role: Role): Promise<void> {
    const token = await this.getAdminToken()
    const base = this.realmBase(realm)
    const roleRep = await this.fetchRoleRepresentation(token, base, role)
    await this.kc(token, `${base}/users/${kcId}/role-mappings/realm`, {
      method: 'DELETE',
      body: JSON.stringify([{ id: roleRep.id, name: roleRep.name }]),
    })
  }

  /**
   * Best-effort, mirroring the control-plane step: a dev/staging Keycloak without SMTP
   * configured returns a non-2xx (or throws) here. The invite itself (KC user + tenant User +
   * GRANT) is already complete by the time this runs, so a failure MUST NOT be surfaced as a
   * fatal error to the caller — log and return.
   */
  async sendPasswordSetupEmail(realm: string, kcId: string): Promise<void> {
    const token = await this.getAdminToken()
    const base = this.realmBase(realm)
    try {
      const resp = await this.fetchFn(`${base}/users/${kcId}/execute-actions-email`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['UPDATE_PASSWORD']),
      })
      if (!resp.ok) {
        this.logger.warn(
          { realm, kcId, status: resp.status },
          'Keycloak execute-actions-email failed (likely no SMTP in this env) — continuing (best-effort)',
        )
      }
    } catch (err) {
      this.logger.warn({ realm, kcId, err }, 'Keycloak execute-actions-email threw — continuing (best-effort)')
    }
  }

  /**
   * Used as the compensation action when the tenant-DB User write fails AFTER the KC user was
   * already created: disable (never hard-delete) the KC user and let reconciliation retry the
   * DB write later.
   */
  async setEnabled(realm: string, kcId: string, enabled: boolean): Promise<void> {
    const token = await this.getAdminToken()
    const base = this.realmBase(realm)
    await this.kc(token, `${base}/users/${kcId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    })
  }

  /**
   * Reads back the Keycloak-side truth for `UsersService.reconcile`: the realm-role NAMES
   * currently mapped to `kcId` (what `RbacGuard` actually trusts via the `hrobot_roles` JWT
   * claim). Used only to DIFF against the tenant `UserRole` rows — never to drive an
   * authorization decision on its own.
   */
  async getUserRealmRoles(realm: string, kcId: string): Promise<string[]> {
    const token = await this.getAdminToken()
    const base = this.realmBase(realm)
    const resp = await this.kc(token, `${base}/users/${encodeURIComponent(kcId)}/role-mappings/realm`, { method: 'GET' })
    const roles = (await resp.json()) as Array<{ name: string }>
    return roles.map((r) => r.name)
  }
}
