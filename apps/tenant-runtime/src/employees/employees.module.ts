import { Module } from '@nestjs/common'
import { parseEnv } from '@hrobot/config'
import { EncryptionService } from '@hrobot/shared'
import { deriveBlindIndexKey } from '@hrobot/db'
import { EmployeesController } from './employees.controller.js'
import { EmployeesService } from './employees.service.js'

/** DI token for the 32-byte PESEL blind-index HMAC key (derived from TENANT_DB_ENCRYPTION_KEY). */
export const PESEL_BI_KEY = 'PESEL_BI_KEY'

@Module({
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    {
      provide: EncryptionService,
      useFactory: (): EncryptionService => new EncryptionService(Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')),
    },
    {
      provide: PESEL_BI_KEY,
      useFactory: (): Buffer => deriveBlindIndexKey(parseEnv().TENANT_DB_ENCRYPTION_KEY),
    },
  ],
})
export class EmployeesModule {}
