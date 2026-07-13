import { randomUUID } from 'node:crypto'
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { TenantPrisma } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { KeycloakAdminService } from '../tenant-runtime/keycloak/keycloak-admin.service.js'

/** The acting user projected from the JWT + IP (mirrors EmployeeActor/AccessActor). */
export interface UsersActor {
  userId: string // JWT `sub` == tenant `User.keycloakSub` (NOT `User.id`).
  roles: string[]
  ipAddress: string
}

/** RODO-safe roster projection: email/active/createdAt/roles only — no PII beyond email. */
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  active: true,
  createdAt: true,
  roles: { select: { role: true, unitId: true } },
} as const

type UserRow = TenantPrisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>

/** Privilege ranking used ONLY for the SELF-ESCALATION guard — never for RBAC scoping. */
const ROLE_RANK: Record<Role, number> = {
  [Role.PRACOWNIK]: 0,
  [Role.MANAGER]: 1,
  [Role.HR]: 2,
  [Role.ADMIN_KLIENTA]: 3,
}

/**
 * UŻYTKOWNICY — user invites + RBAC role management. This is the highest-risk module in M2: every
 * mutation here is a NON-ATOMIC dual-write between Keycloak (the source of the JWT `hrobot_roles`
 * claim `RbacGuard` trusts) and the tenant `UserRole` table (the source `managedUnitIds`/unit-scope
 * checks trust — see `../tenant-runtime/rbac/unit-scope.ts`). There is no distributed transaction
 * across the two systems, so every write below is ordered so that ANY single-step failure leaves
 * the tenant in a SAFE state (no accidental privilege) rather than a merely consistent one — see
 * {@link grant}/{@link revokeInternal} for the exact ordering + reasoning.
 *
 * JWT-cache inconsistency window: a Keycloak access token is valid (and its `hrobot_roles` claim
 * trusted by `RbacGuard`) for up to its configured lifetime (~3600s) after issuance, even if the
 * underlying Keycloak realm-role mapping or `User.active` flag changes moments later. Every
 * PRIVILEGED mutation here (`assignRole`/`revokeRole`/`deactivate`) re-resolves the actor's REAL
 * current DB state (see {@link resolveActingUser}) instead of trusting the JWT alone — this is the
 * one corner of tenant-runtime where that re-check happens; elsewhere (e.g. `RbacGuard`,
 * `TenantContextInterceptor`), `User.active` is still silently ignored.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(
    private readonly audit: AuditService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  private writeAudit(client: TenantClient, actor: UsersActor, action: string, id: string, payload: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action, entityType: 'User', entityId: id, payload, ipAddress: actor.ipAddress })
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002'
  }

  /** Postgres SERIALIZABLE write-skew abort, surfaced by Prisma as P2034 — see {@link guardedAdminMutation}. */
  private isSerializationFailure(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2034'
  }

  /** Maps a `User` create's P2002 (duplicate `email`/`keycloakSub`) to a clean 409; anything else rethrows. */
  private mapWriteError(err: unknown): never {
    if (this.isUniqueViolation(err)) throw new ConflictException('A user with this email already exists')
    throw err
  }

  /**
   * GRANT ordering: the `UserRole` row is written FIRST — so a unit-scope read
   * (`managedUnitIds`/`isGlobal`) is already correct before the privilege can possibly appear in a
   * token — THEN the Keycloak realm-role mapping is granted, so the `hrobot_roles` claim shows up
   * on the user's *next* token. If the KC call fails, the `UserRole` row is left dangling with no
   * matching JWT claim: `RbacGuard` never sees it, so no privilege actually leaked — safe to leave
   * for reconciliation.
   *
   * The `UserRole` write tolerates a unique-constraint violation (P2002) as an idempotent no-op: a
   * unit-scoped grant is covered by the existing `@@unique([userId, role, unitId])`; a GLOBAL grant
   * (`unitId: null`) relies on the hand-appended partial-unique index from the
   * `20260713230000_user_role_global_partial_unique` migration (Postgres does not dedupe repeated
   * NULLs under a plain composite unique). Either way the KC assign is still (re-)issued afterward
   * so a retried GRANT still converges on the claim being present.
   */
  private async grant(client: TenantClient, realm: string, userId: string, kcId: string, role: Role, unitId: string | null): Promise<void> {
    try {
      await client.userRole.create({ data: { userId, role, unitId } })
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err
    }
    await this.keycloak.assignRealmRole(realm, kcId, role)
  }

  /**
   * REVOKE ordering — the mirror image of {@link grant}: the Keycloak realm-role mapping is removed
   * FIRST (the `hrobot_roles` claim disappears on the user's *next* token), THEN the `UserRole` row
   * is deleted. If the `UserRole` delete fails after a successful KC removal, the dangling row
   * carries no matching JWT claim — safe to leave for reconciliation.
   */
  private async revokeInternal(client: TenantClient, realm: string, userId: string, kcId: string, role: Role, unitId: string | null): Promise<void> {
    await this.keycloak.removeRealmRole(realm, kcId, role)
    await client.userRole.deleteMany({ where: { userId, role, unitId } })
  }

  /**
   * Re-resolves the caller's REAL current DB state — never the JWT alone (see the class doc for
   * why). Used by every privileged mutation to check `active` and, for the self-escalation guard,
   * the actor's REAL current roles.
   */
  private resolveActingUser(
    client: TenantClient,
    actor: UsersActor,
  ): Promise<{ id: string; active: boolean; roles: Array<{ role: Role; unitId: string | null }> } | null> {
    return client.user.findFirst({
      where: { keycloakSub: actor.userId },
      select: { id: true, active: true, roles: { select: { role: true, unitId: true } } },
    })
  }

  /**
   * Re-resolves AND re-verifies the actor's REAL current DB state before ANY privileged mutation —
   * requires `active` AND that the actor's REAL (DB) roles include `ADMIN_KLIENTA`, not just the
   * cheap JWT-claim check the caller already did. This is what actually closes the JWT-cache window
   * for EVERY target, not only the self-escalation case handled inline in {@link assignRole}: without
   * this check, `actor.roles.includes(ADMIN_KLIENTA)` (the untrusted, up-to-~3600s-stale JWT claim)
   * would be the ONLY ADMIN_KLIENTA check applied whenever the target is someone OTHER than the actor
   * — letting a demoted admin keep granting/revoking roles or deactivating OTHER users until their
   * token expires.
   */
  private async requireRealAdmin(
    client: TenantClient,
    actor: UsersActor,
  ): Promise<{ id: string; active: boolean; roles: Array<{ role: Role; unitId: string | null }> }> {
    const actingUser = await this.resolveActingUser(client, actor)
    if (!actingUser || !actingUser.active) {
      throw new ForbiddenException('Actor is not an active user in the current DB state')
    }
    if (!actingUser.roles.some((r) => r.role === Role.ADMIN_KLIENTA)) {
      throw new ForbiddenException('Actor no longer holds ADMIN_KLIENTA in the current DB state')
    }
    return actingUser
  }

  /**
   * LAST-ADMIN guard + guarded write, wrapped as ONE atomic unit. The plain read-then-decide this
   * used to be (`findMany` the global admins, then separately call KC + write DB) has a classic
   * write-skew hole: with exactly 2 active global ADMIN_KLIENTA users, two CONCURRENT revoke/deactivate
   * calls targeting the two DIFFERENT admins can each read "2 admins left, not the last one" and both
   * pass the guard before either write commits — leaving the tenant with ZERO admins.
   *
   * The `updateMany`/`deleteMany` + `count === 0` optimistic-lock idiom `ai-proposal.service.ts` uses
   * for its concurrent-state races doesn't directly apply here: that idiom re-asserts a precondition
   * on the SAME row being written (e.g. `state: DRAFT`), but the last-admin invariant is an AGGREGATE
   * over MULTIPLE rows (every global `ADMIN_KLIENTA` `UserRole`) spanning potentially different admins
   * — no single-row `WHERE` predicate can express "count of matching rows across the table > 1".
   *
   * Instead, the count-check and `mutate` (the KC call + the DB write) run inside ONE
   * `SERIALIZABLE` Prisma transaction. Postgres's serializable-snapshot isolation detects the
   * cross-row read/write conflict between the two concurrent transactions at COMMIT time and aborts
   * one of them with a serialization failure (Prisma error code `P2034`) — which we translate into a
   * 409 asking the caller to retry. This is the same "detect the loser, reject, ask for retry" shape
   * as the single-row idiom, just enforced by the database's SSI machinery rather than a single
   * `WHERE` clause, because the invariant genuinely spans rows a single `updateMany` cannot see.
   */
  private async guardedAdminMutation<T>(client: TenantClient, targetUserId: string, mutate: (tx: TenantClient) => Promise<T>): Promise<T> {
    try {
      return await client.$transaction(
        async (tx) => {
          const admins = await tx.userRole.findMany({
            where: { role: Role.ADMIN_KLIENTA, unitId: null, user: { active: true } },
            select: { userId: true },
          })
          const distinctAdminIds = new Set(admins.map((a) => a.userId))
          if (distinctAdminIds.size <= 1 && distinctAdminIds.has(targetUserId)) {
            throw new ConflictException('Cannot remove the last ADMIN_KLIENTA of this tenant')
          }
          return mutate(tx as unknown as TenantClient)
        },
        { isolationLevel: TenantPrisma.TransactionIsolationLevel.Serializable },
      )
    } catch (err) {
      if (this.isSerializationFailure(err)) {
        throw new ConflictException('Admin roster changed concurrently — please retry')
      }
      throw err
    }
  }

  /**
   * Invite a new tenant user: (1) create the Keycloak login → `kcId`; (2) create the tenant `User`
   * row (`id` is APP-SUPPLIED — `randomUUID()`, since `User.id` has no Prisma `@default` — with
   * `keycloakSub: kcId` read back from Keycloak's `Location` header, never trusted from the request
   * body); (3) GRANT the initial role (see {@link grant}); (4) best-effort email the password-setup
   * link (`KeycloakAdminService.sendPasswordSetupEmail` already swallows its own failures).
   *
   * If step (2) fails AFTER the KC user was already created, the KC user is DISABLED (never
   * hard-deleted — LOCKED DECISION) and the failure is logged for reconciliation; a dedicated
   * reconciliation job/endpoint is out of scope for this stage.
   */
  async invite(
    client: TenantClient,
    actor: UsersActor,
    realm: string,
    email: string,
    role: Role,
    unitId: string | null = null,
  ): Promise<UserRow> {
    if (!actor.roles.includes(Role.ADMIN_KLIENTA)) {
      throw new ForbiddenException('Only ADMIN_KLIENTA may invite users')
    }

    const kcId = await this.keycloak.createUser(realm, email)

    let user: UserRow
    try {
      user = await client.user.create({
        data: { id: randomUUID(), email, keycloakSub: kcId, active: true },
        select: SAFE_USER_SELECT,
      })
    } catch (err) {
      await this.keycloak.setEnabled(realm, kcId, false).catch((compErr: unknown) => {
        this.logger.error(
          { compErr, kcId, realm, email },
          'invite: compensating setEnabled(false) failed after a DB User-create failure — this Keycloak user needs manual reconciliation',
        )
      })
      this.mapWriteError(err)
    }

    await this.grant(client, realm, user.id, kcId, role, unitId)
    await this.keycloak.sendPasswordSetupEmail(realm, kcId)

    await this.writeAudit(client, actor, 'user.invited', user.id, { role, unitId })
    return user
  }

  /**
   * Grant `role` (optionally scoped to `unitId`) to `targetUserId`. ADMIN_KLIENTA-only (cheap JWT
   * check — 403 before any DB/KC call), re-verified against the actor's REAL DB state. Guarded
   * against SELF-ESCALATION: an actor may never grant *themselves* a role ranked higher than the
   * highest rank among their own REAL (not JWT) current roles — this is what actually closes the
   * JWT-cache window (a demoted admin holding a still-valid ADMIN_KLIENTA JWT cannot use it to
   * re-grant themselves ADMIN_KLIENTA in the DB).
   */
  async assignRole(
    client: TenantClient,
    actor: UsersActor,
    realm: string,
    targetUserId: string,
    role: Role,
    unitId: string | null = null,
  ): Promise<void> {
    if (!actor.roles.includes(Role.ADMIN_KLIENTA)) {
      throw new ForbiddenException('Only ADMIN_KLIENTA may manage roles')
    }

    const actingUser = await this.requireRealAdmin(client, actor)

    const target = await client.user.findUnique({ where: { id: targetUserId }, select: { id: true, keycloakSub: true } })
    if (!target) throw new NotFoundException(`User ${targetUserId} not found`)

    if (target.id === actingUser.id) {
      const actingRank = actingUser.roles.reduce((max, r) => Math.max(max, ROLE_RANK[r.role]), -1)
      if (ROLE_RANK[role] > actingRank) {
        throw new ForbiddenException('Cannot grant yourself a role higher than your current (real) role')
      }
    }

    await this.grant(client, realm, target.id, target.keycloakSub, role, unitId)
    await this.writeAudit(client, actor, 'role.assigned', target.id, { role, unitId })
  }

  /**
   * Revoke `role` (optionally scoped to `unitId`) from `targetUserId`. Same ADMIN_KLIENTA +
   * real-DB-state re-check as {@link assignRole}. A GLOBAL `ADMIN_KLIENTA` revoke is additionally
   * guarded against removing the tenant's LAST admin (see {@link guardedAdminMutation}).
   */
  async revokeRole(
    client: TenantClient,
    actor: UsersActor,
    realm: string,
    targetUserId: string,
    role: Role,
    unitId: string | null = null,
  ): Promise<void> {
    if (!actor.roles.includes(Role.ADMIN_KLIENTA)) {
      throw new ForbiddenException('Only ADMIN_KLIENTA may manage roles')
    }

    await this.requireRealAdmin(client, actor)

    const target = await client.user.findUnique({ where: { id: targetUserId }, select: { id: true, keycloakSub: true } })
    if (!target) throw new NotFoundException(`User ${targetUserId} not found`)

    if (role === Role.ADMIN_KLIENTA && unitId === null) {
      await this.guardedAdminMutation(client, target.id, (tx) => this.revokeInternal(tx, realm, target.id, target.keycloakSub, role, unitId))
    } else {
      await this.revokeInternal(client, realm, target.id, target.keycloakSub, role, unitId)
    }
    await this.writeAudit(client, actor, 'role.revoked', target.id, { role, unitId })
  }

  /**
   * Deactivate a user: Keycloak `setEnabled(false)` FIRST — blocks any *new* token issuance
   * immediately, mirroring REVOKE's KC-first ordering — THEN `User.active = false`. If the KC call
   * fails, nothing is changed (the user stays fully active) rather than flipping the DB flag out of
   * sync with a still-enabled Keycloak login. Guarded against deactivating the tenant's LAST admin.
   */
  async deactivate(client: TenantClient, actor: UsersActor, realm: string, targetUserId: string): Promise<void> {
    if (!actor.roles.includes(Role.ADMIN_KLIENTA)) {
      throw new ForbiddenException('Only ADMIN_KLIENTA may deactivate users')
    }

    await this.requireRealAdmin(client, actor)

    const target = await client.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, keycloakSub: true, roles: { select: { role: true, unitId: true } } },
    })
    if (!target) throw new NotFoundException(`User ${targetUserId} not found`)

    const isAdmin = target.roles.some((r) => r.role === Role.ADMIN_KLIENTA && r.unitId === null)
    if (isAdmin) {
      await this.guardedAdminMutation(client, target.id, async (tx) => {
        await this.keycloak.setEnabled(realm, target.keycloakSub, false)
        await tx.user.update({ where: { id: target.id }, data: { active: false } })
      })
    } else {
      await this.keycloak.setEnabled(realm, target.keycloakSub, false)
      await client.user.update({ where: { id: target.id }, data: { active: false } })
    }

    await this.writeAudit(client, actor, 'user.deactivated', target.id, {})
  }

  /** RODO-safe roster: `SAFE_USER_SELECT` never returns anything beyond id/email/active/createdAt/roles. */
  async list(client: TenantClient): Promise<UserRow[]> {
    return client.user.findMany({ orderBy: { createdAt: 'desc' }, select: SAFE_USER_SELECT })
  }

  /**
   * Diffs Keycloak's realm-role mappings (what `RbacGuard` actually trusts, via the `hrobot_roles`
   * JWT claim) against the tenant `UserRole` rows, for every user (or just `opts.userId` if given).
   * ADMIN_KLIENTA-only, re-verified against the actor's REAL DB state — same posture as every other
   * privileged mutation in this class.
   *
   * A dangling row can only ever take ONE shape from {@link grant}/{@link revokeInternal}'s ordering:
   * a `UserRole` row with no matching KC realm-role mapping ('db_only') — see their doc comments for
   * why both an interrupted GRANT (KC step failed) and an interrupted REVOKE (DB-delete step failed
   * after the KC removal already succeeded) converge on this exact same observable shape. Because the
   * two causes are genuinely indistinguishable from the dangling state alone, `opts.fix` resolves
   * 'db_only' findings by DELETING the dangling `UserRole` row(s) — never by re-issuing the KC grant.
   * This is the conservative direction: it can never auto-escalate privilege (KC, the JWT source of
   * truth, is left untouched), and if the row really was an interrupted GRANT the admin can simply
   * re-run it.
   *
   * A 'kc_only' finding (KC has the role mapping, no matching `UserRole` row) should never arise from
   * this class's own write paths — it signals an out-of-band Keycloak change. It is always REPORTED,
   * never auto-fixed: silently removing it would revoke a real, currently-effective privilege without
   * human review.
   *
   * Best-effort per user: a Keycloak read failure for one user is logged and skipped rather than
   * aborting the whole reconciliation pass.
   */
  async reconcile(
    client: TenantClient,
    actor: UsersActor,
    realm: string,
    opts: { fix?: boolean; userId?: string } = {},
  ): Promise<ReconcileResult> {
    if (!actor.roles.includes(Role.ADMIN_KLIENTA)) {
      throw new ForbiddenException('Only ADMIN_KLIENTA may run reconciliation')
    }
    await this.requireRealAdmin(client, actor)

    const knownRoles = new Set<string>(Object.values(Role))
    const users = await client.user.findMany({
      where: opts.userId ? { id: opts.userId } : undefined,
      select: { id: true, keycloakSub: true, roles: { select: { role: true } } },
    })

    const findings: ReconcileFinding[] = []
    let fixedCount = 0

    for (const user of users) {
      let kcRoleNames: string[]
      try {
        kcRoleNames = await this.keycloak.getUserRealmRoles(realm, user.keycloakSub)
      } catch (err) {
        this.logger.error(
          { err, userId: user.id, realm },
          'reconcile: failed to read Keycloak role mappings for this user — skipping (best-effort)',
        )
        continue
      }

      const kcRoles = new Set(kcRoleNames.filter((r) => knownRoles.has(r)) as Role[])
      const dbRoles = new Set(user.roles.map((r) => r.role))

      for (const role of dbRoles) {
        if (kcRoles.has(role)) continue
        findings.push({ userId: user.id, role, kind: 'db_only' })
        if (opts.fix) {
          await client.userRole.deleteMany({ where: { userId: user.id, role } })
          fixedCount++
        }
      }
      for (const role of kcRoles) {
        if (!dbRoles.has(role)) findings.push({ userId: user.id, role, kind: 'kc_only' })
      }
    }

    await this.writeAudit(client, actor, 'user.reconciled', opts.userId ?? 'ALL', {
      fix: Boolean(opts.fix),
      findingsCount: findings.length,
      fixedCount,
    })

    return { findings, fixedCount }
  }
}

/**
 * One diff entry from {@link UsersService.reconcile} — see that method's doc for the meaning of each
 * `kind` and why 'db_only' is the only one ever auto-fixable.
 */
export interface ReconcileFinding {
  userId: string
  role: Role
  kind: 'db_only' | 'kc_only'
}

export interface ReconcileResult {
  findings: ReconcileFinding[]
  fixedCount: number
}
