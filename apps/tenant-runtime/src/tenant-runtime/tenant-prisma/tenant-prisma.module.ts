import { Module } from '@nestjs/common'
import { TenantPrismaManager, TenantClient } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { parseEnv } from '@hrobot/config'
import { TenantConnectionResolverService } from './tenant-connection-resolver.service.js'

@Module({
  providers: [
    TenantConnectionResolverService,
    {
      provide: EncryptionService,
      useFactory: (): EncryptionService =>
        new EncryptionService(Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')),
    },
    {
      provide: TenantPrismaManager,
      useFactory: (resolver: TenantConnectionResolverService): TenantPrismaManager =>
        new TenantPrismaManager(
          resolver,
          (datasourceUrl: string) => new TenantClient({ datasourceUrl }),
        ),
      inject: [TenantConnectionResolverService],
    },
  ],
  exports: [TenantPrismaManager],
})
export class TenantPrismaModule {}
