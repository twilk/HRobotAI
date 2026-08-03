import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { parseEnv } from '@hrobot/config'
import type { ControlPlanePrisma } from '@hrobot/db'
import { EncryptionService, ProvisioningStep, Role } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

type FetchFn = typeof fetch

/** G-2: metadata keys holding the one-time bootstrap credential (see the class doc-comment). */
export const BOOTSTRAP_PASSWORD_KEY = 'bootstrapPassword'
export const BOOTSTRAP_ISSUED_AT_KEY = 'bootstrapPasswordIssuedAt'

/** G-2: AAD binding a bootstrap ciphertext to its tenant, so a blob cannot be copied to another
 *  tenant's row and still authenticate. Shared with the retrieval endpoint. */
export const bootstrapAad = (tenantId: string): string => `tenant:${tenantId}:bootstrap`

@Injectable()
export class KeycloakSetupStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(KeycloakSetupStep.name)
  private readonly keycloakUrl: string
  private readonly adminPassword: string

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('FETCH') private readonly fetchFn: FetchFn,
    private readonly encryption: EncryptionService,
  ) {
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
    const data = await resp.json() as { access_token: string }
    return data.access_token
  }

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })
    const meta = tenant.metadata as Record<string, unknown>
    const adminEmail = String(meta['adminEmail'] ?? '')
    const realmName = `hrobot-${tenant.slug}`
    const adminBase = `${this.keycloakUrl}/admin/realms`
    const token = await this.getAdminToken()

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    // FIX-C4: check every Keycloak response and tolerate 409 Conflict (the resource already
    // exists) so the whole step is safe to retry. Any other non-2xx fails the step for retry.
    const kc = async (url: string, init: RequestInit): Promise<Response> => {
      const r = await this.fetchFn(url, init)
      if (!r.ok && r.status !== 409) {
        throw new Error(`keycloak ${init.method ?? 'GET'} ${url} -> ${r.status}`)
      }
      return r
    }

    // 1. Create realm (idempotent)
    await kc(`${adminBase}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        realm: realmName,
        enabled: true,
        accessTokenLifespan: 300,
        ssoSessionMaxLifespan: 36000,
      }),
    })

    // 2. Create the realm roles. Driven from the shared Role enum so it stays in lock-step
    //    with RBAC. ADMIN_GLOBALNY is intentionally absent — it is a control-plane operator
    //    role that never lives in a tenant realm. Idempotent: kc() tolerates 409 on retry.
    for (const roleName of Object.values(Role)) {
      await kc(`${adminBase}/${realmName}/roles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: roleName }),
      })
    }

    // 3. Create the hrobot-web client with a realm-role protocol mapper that projects the
    //    user's realm roles into a top-level, multivalued `hrobot_roles` claim in the access
    //    token. The tenant runtime's KeycloakJwtStrategy/RbacGuard read exactly this claim
    //    (not realm_access.roles), so without this mapper @Roles() is unsatisfiable.
    await kc(`${adminBase}/${realmName}/clients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientId: 'hrobot-web',
        redirectUris: [`https://${tenant.slug}.hrobot.ai/*`],
        webOrigins: [`https://${tenant.slug}.hrobot.ai`],
        publicClient: true,
        protocolMappers: [
          {
            name: 'hrobot-realm-roles',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-usermodel-realm-role-mapper',
            config: {
              'claim.name': 'hrobot_roles',
              'jsonType.label': 'String',
              multivalued: 'true',
              'access.token.claim': 'true',
              'id.token.claim': 'false',
              'userinfo.token.claim': 'false',
              'usermodel.realmRoleMapping.rolePrefix': '',
            },
          },
        ],
      }),
    })

    // 4. Create the initial admin user with a temporary password. `temporary: true` makes
    //    Keycloak force a password change on first login, so this credential is single-use by
    //    construction. On a retry the user already exists → 409 → Keycloak IGNORES the
    //    credentials in the body, so `tempPassword` is only real when the create actually
    //    succeeded; `userCreated` records that (see step 7).
    const tempPassword = randomBytes(12).toString('base64url')
    const createUserResp = await kc(`${adminBase}/${realmName}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: adminEmail,
        email: adminEmail,
        enabled: true,
        credentials: [{ type: 'password', value: tempPassword, temporary: true }],
      }),
    })

    const userCreated = createUserResp.status !== 409

    // FIX-C4: never derive the userId from Location alone — on a retry the user already
    // exists (409, no Location header), so fall back to looking it up by email.
    let userId = ((createUserResp.headers as { get(name: string): string | null }).get('Location') ?? '')
      .split('/')
      .pop() ?? ''
    if (!userId) {
      const lookupResp = await kc(
        `${adminBase}/${realmName}/users?email=${encodeURIComponent(adminEmail)}&exact=true`,
        { method: 'GET', headers },
      )
      const users = await lookupResp.json() as Array<{ id: string }>
      userId = users[0]?.id ?? ''
    }

    // 5. Assign ADMIN_KLIENTA to the initial user. role-mappings/realm needs the full role
    //    representation, so fetch it first to get its id.
    const roleResp = await kc(`${adminBase}/${realmName}/roles/${Role.ADMIN_KLIENTA}`, {
      method: 'GET',
      headers,
    })
    const adminRole = await roleResp.json() as { id: string; name: string }
    await kc(`${adminBase}/${realmName}/users/${userId}/role-mappings/realm`, {
      method: 'POST',
      headers,
      body: JSON.stringify([{ id: adminRole.id, name: adminRole.name }]),
    })

    // 6. Send credential-reset email so the admin sets their own password. BEST-EFFORT: this
    //    needs SMTP configured on the realm; a dev Keycloak without SMTP returns 500. The tenant
    //    is already fully provisioned (realm + client + roles + admin user + role mapping), so a
    //    failure here must NOT fail provisioning — log and continue.
    let emailDelivered = false
    try {
      const emailResp = await this.fetchFn(
        `${adminBase}/${realmName}/users/${userId}/execute-actions-email`,
        { method: 'PUT', headers, body: JSON.stringify(['UPDATE_PASSWORD']) },
      )
      emailDelivered = emailResp.ok
      if (!emailResp.ok) {
        this.logger.warn(
          { tenantId: job.tenantId, realmName, status: emailResp.status },
          'Keycloak execute-actions-email failed (likely no SMTP in this env) — skipping; tenant is still provisioned',
        )
      }
    } catch (err) {
      this.logger.warn({ tenantId: job.tenantId, realmName, err }, 'Keycloak execute-actions-email threw — skipping')
    }

    this.logger.log({ tenantId: job.tenantId, realmName }, 'Keycloak realm provisioned')

    // 7. G-2: guarantee an onboarding path even with no SMTP. Previously the temp password was
    //    generated, handed to Keycloak and then DROPPED, so when the reset e-mail could not be
    //    delivered the freshly provisioned tenant had a working realm and an admin account nobody
    //    could log into. Now, and ONLY when the e-mail did not go out, the credential is kept as a
    //    one-time bootstrap secret:
    //      - encrypted at rest with the same AES-256-GCM service that protects tenants.db_url,
    //        AAD-bound to this tenant id (a blob cannot be moved to another tenant's row);
    //      - never logged, never returned by the public status endpoint;
    //      - readable exactly once, by a GLOBAL_ADMIN, via
    //        GET /provision/bootstrap-credentials/:tenantId, which wipes it on read;
    //      - already single-use downstream, because Keycloak marks it `temporary: true`.
    //    Only stored when THIS run actually created the user — on a 409 retry Keycloak ignored
    //    the credential in the request body, so `tempPassword` was never set on the account and
    //    persisting it would hand out a password that does not work. If the e-mail DID go out the
    //    admin has a real reset link, so any previously stored blob is wiped: no secret lingers
    //    longer than it is needed.
    const nextMeta: Record<string, unknown> = { ...meta, realmName, keycloakClientId: 'hrobot-web' }
    if (emailDelivered) {
      delete nextMeta[BOOTSTRAP_PASSWORD_KEY]
      delete nextMeta[BOOTSTRAP_ISSUED_AT_KEY]
    } else if (userCreated) {
      nextMeta[BOOTSTRAP_PASSWORD_KEY] = this.encryption.encrypt(
        tempPassword,
        bootstrapAad(job.tenantId),
      )
      nextMeta[BOOTSTRAP_ISSUED_AT_KEY] = new Date().toISOString()
      this.logger.warn(
        { tenantId: job.tenantId, realmName, adminEmail },
        'No password-reset e-mail was delivered — stored a one-time bootstrap credential; a GLOBAL_ADMIN can retrieve it once via GET /provision/bootstrap-credentials/:tenantId',
      )
    }

    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: { metadata: nextMeta as ControlPlanePrisma.InputJsonObject },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.DONE },
    })
  }
}
