import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
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

/** Fields safe to return to any in-scope reader — pesel is NEVER selected here (RODO). */
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
}
