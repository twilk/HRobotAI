import { Inject, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'

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
