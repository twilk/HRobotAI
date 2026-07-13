import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { decryptEmployeePesel, encryptEmployeePesel, TenantPrisma } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import type { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto.js'

/**
 * DI token for the 32-byte PESEL blind-index HMAC key. Defined here (not in employees.module.ts) so
 * the module can import it alongside `EmployeesService` without a module<->service circular import
 * (mirrors grafik's `OPTIMIZER_CLIENT`, which lives in optimizer.client.ts for the same reason).
 */
export const PESEL_BI_KEY = 'PESEL_BI_KEY'

/** The acting user projected from the JWT + IP (mirrors GrafikActor). */
export interface EmployeeActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/** RODO: pesel/peselHash are NEVER selected here — this is the roster projection for every role. */
const SAFE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  position: true,
  employmentType: true,
  hiredAt: true,
  unitId: true,
  etat: true,
  qualifications: true,
} as const

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name)

  constructor(
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    @Inject(PESEL_BI_KEY) private readonly peselBlindIndexKey: Buffer,
  ) {}

  private writeAudit(client: TenantClient, actor: EmployeeActor, action: string, id: string, payload: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action, entityType: 'Employee', entityId: id, payload, ipAddress: actor.ipAddress })
  }

  /**
   * Map the Prisma write errors an employee create/update can hit onto clean 4xx responses instead of
   * raw 500s (which could leak internal Prisma text). Shared by both write paths:
   *   - P2002 (unique constraint) → 409; the only unique column either write touches is `peselHash`.
   *   - P2003 (foreign-key constraint) → 400; a syntactically-valid but nonexistent `unitId` fails the
   *     `unit` FK. `unitId` passes `@IsUUID()`, so this is a real user-writable failure mode.
   * Anything else is rethrown unchanged. Return type is `never` — it always throws.
   */
  private mapWriteError(err: unknown): never {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as { code: string }).code
      if (code === 'P2002') throw new ConflictException('Employee with this PESEL already exists')
      if (code === 'P2003') throw new BadRequestException('Invalid unitId: unit does not exist')
    }
    throw err
  }

  /**
   * RODO ALLOWLIST projection: copy ONLY the SAFE_SELECT keys off a raw Employee row. This is the
   * single gate that keeps PII (`pesel`/`peselHash`, and the home-address columns `homeAddress`/
   * `homeLat`/`homeLng`) out of API responses AND out of the append-only `audit_log` (a DB trigger
   * blocks UPDATE/DELETE, so anything written there is permanently unerasable). A future PII column
   * cannot leak unless someone explicitly adds it to SAFE_SELECT.
   */
  private toSafeEmployee(row: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {}
    for (const key of Object.keys(SAFE_SELECT)) safe[key] = row[key]
    return safe
  }

  /** The plain employee's own unit, resolved via their Keycloak subject. */
  private async ownUnitId(client: TenantClient, userId: string): Promise<string | null> {
    const me = await client.employee.findFirst({ where: { user: { keycloakSub: userId } }, select: { unitId: true } })
    return me?.unitId ?? null
  }

  /**
   * Unit IDs a non-global actor may see: their managed unit(s) if they manage any, otherwise their
   * own unit. Empty when they manage nothing and have no own Employee record — callers must treat
   * `[]` as "see nothing" (a `where: { unitId: { in: [] } }` matches zero rows), never as a bypass.
   */
  private async resolveScopeUnits(client: TenantClient, actor: EmployeeActor): Promise<string[]> {
    const units = await managedUnitIds(client, actor.userId)
    if (units.length > 0) return units
    const own = await this.ownUnitId(client, actor.userId)
    return own ? [own] : []
  }

  /**
   * Role-scoped employee roster. HR/ADMIN see everyone; a MANAGER sees their managed unit(s); a plain
   * PRACOWNIK sees their own unit. PESEL-free for every role — the single-employee profile (Task 2)
   * is the only place a masked `peselLast4` may appear.
   */
  async list(client: TenantClient, actor: EmployeeActor): Promise<unknown[]> {
    if (isGlobal(actor.roles)) {
      return client.employee.findMany({ orderBy: { hiredAt: 'desc' }, select: SAFE_SELECT })
    }
    const scopeUnits = await this.resolveScopeUnits(client, actor)
    return client.employee.findMany({ where: { unitId: { in: scopeUnits } }, orderBy: { hiredAt: 'desc' }, select: SAFE_SELECT })
  }

  /**
   * Single-employee profile. Same unit-scoping as `list` — 404 fires first for an unknown id, then
   * the scope check (403) for one that exists but is outside the actor's unit(s). Only a GLOBAL
   * actor (HR/ADMIN_KLIENTA) may receive a masked `peselLast4` — everyone else, and any decrypt
   * failure, gets the SAFE_SELECT projection with no PESEL hint at all. The raw Prisma row is NEVER
   * spread into the response: it carries `pesel`/`peselHash`/home-address PII columns that must not
   * leave this method.
   */
  async getById(client: TenantClient, actor: EmployeeActor, id: string, tenantId?: string): Promise<Record<string, unknown>> {
    const emp = await client.employee.findUnique({ where: { id } })
    if (!emp) throw new NotFoundException(`Employee ${id} not found`)
    if (!isGlobal(actor.roles)) {
      const inScope = (await this.resolveScopeUnits(client, actor)).includes(emp.unitId)
      if (!inScope) throw new ForbiddenException('Employee is outside your scope')
    }
    const safe = this.toSafeEmployee(emp as Record<string, unknown>)
    if (isGlobal(actor.roles) && tenantId && emp.pesel) {
      try {
        const plain = decryptEmployeePesel(this.encryption, tenantId, emp.pesel)
        safe.peselLast4 = plain.slice(-4)
      } catch {
        // Decryption failure (bad key rotation state, corrupt ciphertext, …) → omit peselLast4, never throw.
        this.logger.warn(`peselLast4 decrypt failed for employee ${id}`)
      }
    }
    return safe
  }

  /**
   * The caller's OWN employee profile, resolved from their Keycloak subject (no id in the path). Any
   * READ role may call it — a plain PRACOWNIK uses this to see themselves without needing roster scope.
   * Returns the SAFE_SELECT projection only (no PESEL/home-address PII, no `peselLast4`); throws 404
   * when the login has no linked Employee row. The raw Prisma row is NEVER spread into the response.
   */
  async me(client: TenantClient, actor: EmployeeActor): Promise<Record<string, unknown>> {
    const emp = await client.employee.findFirst({ where: { user: { keycloakSub: actor.userId } } })
    if (!emp) throw new NotFoundException('No employee record for the current user')
    return this.toSafeEmployee(emp as Record<string, unknown>)
  }

  /**
   * HR/ADMIN-only partial edit. A new `pesel` (if provided) is encrypted via `@hrobot/db`
   * employeePii before it ever touches the update `data`. Both the audit `before`/`after` snapshots
   * and the returned value pass through `toSafeEmployee` (the SAFE_SELECT allowlist), so no PII —
   * PESEL or home address — can reach the append-only `audit_log` or the API response. `peselHash`
   * is `@unique`; a collision surfaces as a 409 rather than an unhandled Prisma 500.
   */
  async update(client: TenantClient, actor: EmployeeActor, id: string, dto: UpdateEmployeeDto, tenantId: string): Promise<unknown> {
    if (!isGlobal(actor.roles)) throw new ForbiddenException('Only HR/ADMIN may edit employees')
    const before = await client.employee.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`Employee ${id} not found`)

    const { pesel, ...rest } = dto
    const data: Record<string, unknown> = { ...rest }
    if (pesel) Object.assign(data, encryptEmployeePesel(this.encryption, this.peselBlindIndexKey, tenantId, pesel))

    let updated: unknown
    try {
      updated = await client.employee.update({ where: { id }, data })
    } catch (err: unknown) {
      // P2002 (duplicate peselHash) → 409, P2003 (bad unitId FK) → 400; anything else rethrows.
      this.mapWriteError(err)
    }

    await this.writeAudit(client, actor, 'employee.update', id, {
      before: this.toSafeEmployee(before as Record<string, unknown>),
      after: this.toSafeEmployee(updated as Record<string, unknown>),
    })

    return this.toSafeEmployee(updated as Record<string, unknown>)
  }

  /**
   * HR/ADMIN-only create (Task 4a). The new employee has no Keycloak login of their own yet
   * (`userId: null` — a kadrowy-only profile; provisioning a login is a separate, out-of-scope
   * flow). `pesel` is encrypted via `@hrobot/db` `encryptEmployeePesel` before it ever touches the
   * insert `data`; the returned value and the audit `after` snapshot both pass through
   * `toSafeEmployee` (the SAFE_SELECT allowlist), so no PII — PESEL or home address — can reach the
   * append-only `audit_log` or the API response. `peselHash` is `@unique`; a collision surfaces as
   * a 409 rather than an unhandled Prisma 500.
   */
  async create(client: TenantClient, actor: EmployeeActor, dto: CreateEmployeeDto, tenantId: string): Promise<unknown> {
    if (!isGlobal(actor.roles)) throw new ForbiddenException('Only HR/ADMIN may add employees')

    const { pesel, hiredAt, ...rest } = dto
    const enc = encryptEmployeePesel(this.encryption, this.peselBlindIndexKey, tenantId, pesel)
    const data: TenantPrisma.EmployeeUncheckedCreateInput = { ...rest, ...enc, hiredAt: new Date(hiredAt), userId: null }

    let created: unknown
    try {
      created = await client.employee.create({ data })
    } catch (err: unknown) {
      // P2002 (duplicate peselHash) → 409, P2003 (bad unitId FK) → 400; anything else rethrows.
      this.mapWriteError(err)
    }

    const safe = this.toSafeEmployee(created as Record<string, unknown>)
    await this.writeAudit(client, actor, 'employee.create', (created as { id: string }).id, { after: safe })
    return safe
  }
}
