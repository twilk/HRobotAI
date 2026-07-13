import { Inject, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
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
}
