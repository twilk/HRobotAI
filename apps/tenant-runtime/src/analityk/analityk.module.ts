import { Module } from '@nestjs/common'
import { AnalitykController } from './analityk.controller.js'
import { AnalitykService } from './analityk.service.js'

/**
 * Analityk HR module (M3). READ-ONLY: it aggregates the tenant's existing operational tables
 * (`Employee`, `Shift`, `LeaveRequest`, `OrganizationalUnit`, `audit_log`) and owns no schema of its
 * own, so it needs no migration and no `AuditService` — nothing here writes. The tenant client and
 * RBAC plumbing come from the `@Global()` TenantRuntimeModule, so no imports are required.
 */
@Module({
  controllers: [AnalitykController],
  providers: [AnalitykService],
  exports: [AnalitykService],
})
export class AnalitykModule {}
