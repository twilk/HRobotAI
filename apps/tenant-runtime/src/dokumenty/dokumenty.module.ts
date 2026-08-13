import { Module } from '@nestjs/common'
import { parseEnv } from '@hrobot/config'
import { EncryptionService } from '@hrobot/shared'
import { DokumentyController } from './dokumenty.controller.js'
import { DokumentyService } from './dokumenty.service.js'

/**
 * `dokumenty` feature module (SPEC §1.4). Wires the HTTP surface ({@link DokumentyController}) over
 * {@link DokumentyService}. `AuditService` + `RbacGuard` come from the `@Global()`
 * `TenantRuntimeModule`; the per-request tenant client is injected via `@CurrentTenantClient`.
 *
 * `EncryptionService` is provided here EXACTLY as in `employees.module.ts` — same
 * `TENANT_DB_ENCRYPTION_KEY` factory — so the service can decrypt PESEL for the ZUS-only path
 * (§6). No blind-index key is needed: the module only ever DECRYPTS (never re-encrypts) a PESEL.
 */
@Module({
  controllers: [DokumentyController],
  providers: [
    DokumentyService,
    {
      provide: EncryptionService,
      useFactory: (): EncryptionService => new EncryptionService(Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')),
    },
  ],
})
export class DokumentyModule {}
