import { Module } from '@nestjs/common'
import { UstawieniaController } from './ustawienia.controller.js'
import { SettingsService } from './ustawienia.service.js'

/**
 * USTAWIENIA module (M2) — tenant-wide company settings + organizational-unit CRUD. `AuditService`
 * is provided by the `@Global()` TenantRuntimeModule, so it is NOT re-provided here.
 */
@Module({
  controllers: [UstawieniaController],
  providers: [SettingsService],
})
export class UstawieniaModule {}
