import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { parseEnv } from '@hrobot/config'
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
    { provide: 'CREATE_DB_STEP', useClass: CreateDbStep },
    { provide: 'RUN_MIGRATIONS_STEP', useClass: RunMigrationsStep },
    { provide: 'SEED_STEP', useClass: SeedStep },
    { provide: 'KEYCLOAK_SETUP_STEP', useClass: KeycloakSetupStep },
    { provide: 'DONE_STEP', useClass: DoneStep },
  ],
  controllers: [ProvisioningController],
})
export class ProvisioningModule {}
