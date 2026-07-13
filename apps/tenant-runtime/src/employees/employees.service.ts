import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { decryptEmployeePesel, encryptEmployeePesel } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import type { UpdateEmployeeDto } from './dto/employee.dto.js'

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
    const safe: Record<string, unknown> = {}
    for (const key of Object.keys(SAFE_SELECT)) safe[key] = (emp as Record<string, unknown>)[key]
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
   * HR/ADMIN-only partial edit. A new `pesel` (if provided) is encrypted via `@hrobot/db`
   * employeePii before it ever touches `data` or the audit payload — the plaintext AND the
   * ciphertext are scrubbed from both the audit `before` snapshot and the returned/`after` view.
   */
  async update(client: TenantClient, actor: EmployeeActor, id: string, dto: UpdateEmployeeDto, tenantId: string): Promise<unknown> {
    if (!isGlobal(actor.roles)) throw new ForbiddenException('Only HR/ADMIN may edit employees')
    const before = await client.employee.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`Employee ${id} not found`)

    const { pesel, ...rest } = dto
    const data: Record<string, unknown> = { ...rest }
    if (pesel) Object.assign(data, encryptEmployeePesel(this.encryption, this.peselBlindIndexKey, tenantId, pesel))

    await client.employee.update({ where: { id }, data })

    // RODO: audit payload must never carry plaintext or ciphertext PESEL — scrub `before`, and
    // `after` is built from `rest` only (pesel/peselHash were destructured out above).
    const scrub = (row: Record<string, unknown>): Record<string, unknown> => {
      const { pesel: _pesel, peselHash: _peselHash, ...safe } = row
      return safe
    }
    await this.writeAudit(client, actor, 'employee.update', id, {
      before: scrub(before as Record<string, unknown>),
      after: { id, ...rest },
    })

    return { id, ...rest }
  }
}
