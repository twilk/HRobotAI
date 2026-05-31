import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client as PgClient } from 'pg'
import { parseEnv } from '@hrobot/config'
import { EncryptionService } from '@hrobot/shared'
import { TenantClient } from '@hrobot/db'
import { ProvisioningService } from './provisioning.service.js'
import { ProvisioningConsumer } from './provisioning.consumer.js'
import { ProvisioningController } from './provisioning.controller.js'
import { CreateDbStep } from './steps/create-db.step.js'
import { RunMigrationsStep } from './steps/run-migrations.step.js'
import { SeedStep } from './steps/seed.step.js'
import { KeycloakSetupStep } from './steps/keycloak-setup.step.js'
import { DoneStep } from './steps/done.step.js'

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'TENANT_PROVISION_CLIENT',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [parseEnv().RABBITMQ_URL],
            queue: 'tenant.provision',
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  providers: [
    ProvisioningService,
    ProvisioningConsumer,
    {
      provide: 'SUPERUSER_PG_CLIENT',
      useFactory: async (): Promise<PgClient> => {
        const client = new PgClient({ connectionString: parseEnv().POSTGRES_SUPERUSER_URL })
        await client.connect()
        return client
      },
    },
    {
      provide: EncryptionService,
      useFactory: (): EncryptionService =>
        new EncryptionService(Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')),
    },
    {
      provide: 'POSTGRES_HOST',
      useFactory: (): string => new URL(parseEnv().POSTGRES_SUPERUSER_URL).hostname,
    },
    {
      provide: 'POSTGRES_PORT',
      useFactory: (): string => new URL(parseEnv().POSTGRES_SUPERUSER_URL).port || '5432',
    },
    { provide: 'EXEC_FILE', useValue: promisify(execFile) },
    {
      provide: 'TENANT_CLIENT_FACTORY',
      useValue: (datasourceUrl: string) => new TenantClient({ datasourceUrl }),
    },
    { provide: 'CREATE_DB_STEP', useClass: CreateDbStep },
    { provide: 'RUN_MIGRATIONS_STEP', useClass: RunMigrationsStep },
    { provide: 'SEED_STEP', useClass: SeedStep },
    { provide: 'KEYCLOAK_SETUP_STEP', useClass: KeycloakSetupStep },
    { provide: 'DONE_STEP', useClass: DoneStep },
    { provide: 'FETCH', useValue: fetch },
  ],
  controllers: [ProvisioningController],
})
export class ProvisioningModule {}
