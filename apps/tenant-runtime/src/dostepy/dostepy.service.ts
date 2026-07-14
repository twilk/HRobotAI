import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import { AccessStatus } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import type { IssueAccessDto } from './dto/access.dto.js'

/** The acting user projected from the JWT + IP (mirrors EmployeeActor/LeaveActor). */
export interface AccessActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/** Filters for {@link AccessService.list}. */
export interface AccessListFilter {
  employeeId?: string
  status?: string
}

/**
 * RODO ALLOWLIST projection: the AccessGrant's own columns plus a SAFE employee sub-object
 * ({@link EMPLOYEE_SELECT}). The employee relation is narrowed to id/name/unitId ONLY — no `pesel`
 * /`peselHash` or home-address columns can leak into an access response. `identifier` IS selected
 * here (the managing scope legitimately needs the card/key serial), but it is kept OUT of every
 * audit payload (see {@link AccessService.writeAudit} callers).
 */
const EMPLOYEE_SELECT = { id: true, firstName: true, lastName: true, unitId: true } as const

const ACCESS_SELECT = {
  id: true,
  employeeId: true,
  type: true,
  label: true,
  identifier: true,
  lokalizacjaId: true,
  status: true,
  issuedByUserId: true,
  issuedAt: true,
  revokedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  employee: { select: EMPLOYEE_SELECT },
} as const

/** An access-grant row projected through {@link ACCESS_SELECT} (the shape every read/write returns). */
type AccessRow = TenantPrisma.AccessGrantGetPayload<{ select: typeof ACCESS_SELECT }>

/**
 * Dostępy (physical/logical access grants) — issue/revoke of cards, keys and standalone permissions
 * for an employee. Mirrors the RBAC + audit conventions of `EmployeesService`/`LeaveService`:
 * HR/ADMIN_KLIENTA act across every unit (`isGlobal`), a MANAGER only on the unit(s) they manage
 * (`managedUnitIds`). The grant's `identifier` (card/key serial) is security-sensitive: it may be
 * returned to the managing scope but is NEVER written to the append-only audit log.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name)

  constructor(private readonly audit: AuditService) {}

  private writeAudit(client: TenantClient, actor: AccessActor, action: string, id: string, payload: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action, entityType: 'AccessGrant', entityId: id, payload, ipAddress: actor.ipAddress })
  }

  /**
   * Map the Prisma write errors an issue can hit onto clean 4xx responses instead of raw 500s:
   *   - P2002 → 409; the active partial-unique (`access_grant_active_identifier`) already holds an
   *     ACTIVE grant for this (type, identifier) pair.
   *   - P2003 → 400; a syntactically-valid but nonexistent `employeeId` or `lokalizacjaId` fails its
   *     FK (both pass `@IsUUID()`, so this is a real user-writable failure mode).
   * Anything else is rethrown unchanged. Return type is `never` — it always throws.
   */
  private mapWriteError(err: unknown): never {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as { code: string }).code
      if (code === 'P2002') throw new ConflictException('Aktywna karta/klucz o tym identyfikatorze już istnieje')
      if (code === 'P2003') throw new BadRequestException('Invalid employeeId or lokalizacjaId: referenced record does not exist')
    }
    throw err
  }

  /**
   * Authorize the actor for a grant on `unitId`: a GLOBAL actor (HR/ADMIN_KLIENTA) acts on any unit;
   * a MANAGER only on the unit(s) they manage. A null unit (unresolved employee) or one outside the
   * actor's managed set → 403.
   */
  private async assertUnitScope(client: TenantClient, actor: AccessActor, unitId: string | null): Promise<void> {
    if (isGlobal(actor.roles)) return
    const managed = await managedUnitIds(client, actor.userId)
    if (unitId == null || !managed.includes(unitId)) {
      throw new ForbiddenException('Access grant is outside your scope')
    }
  }

  /** The caller's own `User.id` (JWT `sub` == `keycloakSub` != `User.id`), or null if none. */
  private async resolveUserId(client: TenantClient, actor: AccessActor): Promise<string | null> {
    const user = await client.user.findFirst({ where: { keycloakSub: actor.userId }, select: { id: true } })
    return user?.id ?? null
  }

  /** Append a revoke `reason` to the grant's free-text notes (no PII expected). */
  private appendReason(notes: string | null, reason: string): string {
    return notes ? `${notes}\n[revoked] ${reason}` : `[revoked] ${reason}`
  }

  /**
   * Issue a new ACTIVE grant. Authorize: the actor must manage the target employee's unit (or be
   * GLOBAL), else 403. `issuedByUserId` is resolved from the actor's Keycloak subject. A duplicate
   * ACTIVE (type, identifier) → 409; a bad employee/lokalizacja FK → 400. Audit `access.issued`
   * carries IDs only — NEVER the sensitive `identifier`.
   */
  async issue(client: TenantClient, actor: AccessActor, dto: IssueAccessDto): Promise<AccessRow> {
    const emp = await client.employee.findUnique({ where: { id: dto.employeeId }, select: { unitId: true } })
    await this.assertUnitScope(client, actor, emp?.unitId ?? null)

    const issuedByUserId = await this.resolveUserId(client, actor)

    let created: AccessRow
    try {
      created = await client.accessGrant.create({
        data: {
          employeeId: dto.employeeId,
          type: dto.type,
          label: dto.label,
          identifier: dto.identifier ?? null,
          lokalizacjaId: dto.lokalizacjaId ?? null,
          notes: dto.notes ?? null,
          status: AccessStatus.ACTIVE,
          issuedByUserId,
        },
        select: ACCESS_SELECT,
      })
    } catch (err: unknown) {
      // P2002 (duplicate ACTIVE identifier) → 409, P2003 (bad employee/lokalizacja FK) → 400.
      this.mapWriteError(err)
    }

    // RODO/security: IDs only — the sensitive `identifier` is NEVER audited.
    await this.writeAudit(client, actor, 'access.issued', created.id, {
      employeeId: created.employeeId,
      type: created.type,
      status: created.status,
      lokalizacjaId: created.lokalizacjaId,
    })
    return created
  }

  /**
   * Revoke an ACTIVE grant. Authorize with the SAME scope as issue (via the grant's employee unit).
   * Requires `status: ACTIVE` (else 409). The flip is optimistic-locked on `status: ACTIVE`
   * (concurrent change → 409); `revokedAt` is stamped and `reason` (if any) appended to `notes`.
   * Audit `access.revoked` — IDs only.
   */
  async revoke(client: TenantClient, actor: AccessActor, id: string, { reason }: { reason?: string }): Promise<AccessRow> {
    const grant = await client.accessGrant.findUnique({ where: { id }, select: ACCESS_SELECT })
    if (!grant) throw new NotFoundException(`Access grant ${id} not found`)
    await this.assertUnitScope(client, actor, grant.employee.unitId)

    if (grant.status !== AccessStatus.ACTIVE) throw new ConflictException('Access grant is not active')

    const notes = reason != null ? this.appendReason(grant.notes, reason) : grant.notes
    const flipped = await client.accessGrant.updateMany({
      where: { id, status: AccessStatus.ACTIVE },
      data: { status: AccessStatus.REVOKED, revokedAt: new Date(), notes },
    })
    if (flipped.count === 0) throw new ConflictException('Access grant changed concurrently')

    await this.writeAudit(client, actor, 'access.revoked', id, { employeeId: grant.employeeId, status: AccessStatus.REVOKED })
    return client.accessGrant.findUniqueOrThrow({ where: { id }, select: ACCESS_SELECT })
  }

  /**
   * Role-scoped list. A GLOBAL actor sees every grant; a MANAGER only grants whose employee sits in a
   * unit they manage (managed = [] → sees nothing). `employeeId`/`status` narrow within scope. The
   * employee sub-object is the SAFE {@link EMPLOYEE_SELECT} allowlist — no PESEL/home address.
   */
  async list(client: TenantClient, actor: AccessActor, filter: AccessListFilter = {}): Promise<AccessRow[]> {
    const where: TenantPrisma.AccessGrantWhereInput = {}
    if (filter.employeeId != null) where.employeeId = filter.employeeId
    if (filter.status != null) where.status = filter.status as AccessStatus

    if (!isGlobal(actor.roles)) {
      const managed = await managedUnitIds(client, actor.userId)
      where.employee = { unitId: { in: managed } }
    }

    return client.accessGrant.findMany({ where, orderBy: { issuedAt: 'desc' }, select: ACCESS_SELECT })
  }

  /**
   * Load one grant with the SAME scope as {@link list}: 404 first for an unknown id, then a 403 for
   * one that exists but is outside the actor's unit(s). Returns the RODO-safe {@link ACCESS_SELECT}
   * row (SAFE employee sub-object; no PESEL/home address).
   */
  async getById(client: TenantClient, actor: AccessActor, id: string): Promise<AccessRow> {
    const grant = await client.accessGrant.findUnique({ where: { id }, select: ACCESS_SELECT })
    if (!grant) throw new NotFoundException(`Access grant ${id} not found`)
    await this.assertUnitScope(client, actor, grant.employee.unitId)
    return grant
  }
}
