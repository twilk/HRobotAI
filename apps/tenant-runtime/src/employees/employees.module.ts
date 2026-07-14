import { Module } from '@nestjs/common'
import { parseEnv } from '@hrobot/config'
import { EncryptionService } from '@hrobot/shared'
import { deriveBlindIndexKey } from '@hrobot/db'
import { EmployeesController } from './employees.controller.js'
import { EmployeesService, PESEL_BI_KEY } from './employees.service.js'

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
