import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { decryptEmployeePesel } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'

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
   * Role-scoped employee roster. HR/ADMIN see everyone; a MANAGER sees their managed unit(s); a plain
   * PRACOWNIK sees their own unit. PESEL-free for every role — the single-employee profile (Task 2)
   * is the only place a masked `peselLast4` may appear.
   */
  async list(client: TenantClient, actor: EmployeeActor): Promise<unknown[]> {
    if (isGlobal(actor.roles)) {
      return client.employee.findMany({ orderBy: { hiredAt: 'desc' }, select: SAFE_SELECT })
    }
    const units = await managedUnitIds(client, actor.userId)
    const scopeUnits = units.length > 0 ? units : [await this.ownUnitId(client, actor.userId)].filter((u): u is string => !!u)
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
      const units = await managedUnitIds(client, actor.userId)
      const inScope = units.length > 0 ? units.includes(emp.unitId) : emp.unitId === (await this.ownUnitId(client, actor.userId))
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
      }
    }
    return safe
  }
}
