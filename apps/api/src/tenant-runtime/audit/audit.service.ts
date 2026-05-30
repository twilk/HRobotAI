import { Injectable, Logger } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'

export interface AuditLogInput {
  tenantClient: TenantClient
  actorUserId: string
  action: string       // e.g. "employee.update"
  entityType: string   // e.g. "Employee"
  entityId: string
  payload: Record<string, unknown>
  ipAddress: string
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  async log(input: AuditLogInput): Promise<void> {
    if (!input.tenantClient) {
      this.logger.warn('AuditService.log called without a tenant client — skipping')
      return
    }

    await input.tenantClient.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: input.payload as Parameters<typeof input.tenantClient.auditLog.create>[0]['data']['payload'],
        ipAddress: input.ipAddress,
      },
    })
  }
}
