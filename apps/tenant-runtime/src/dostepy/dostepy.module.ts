import { Module } from '@nestjs/common'
import { DostepyController } from './dostepy.controller.js'
import { AccessService } from './dostepy.service.js'

/**
 * Dostępy (physical/logical access grants) module (M2 core-modules). Issue/revoke of cards, keys and
 * standalone permissions for an employee, RBAC-scoped and RODO-safe. `AuditService` is provided by
 * the `@Global()` TenantRuntimeModule, so it is NOT re-provided here.
 */
@Module({
  controllers: [DostepyController],
  providers: [AccessService],
})
export class DostepyModule {}
