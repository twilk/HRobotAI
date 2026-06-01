import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { parseEnv } from '@hrobot/config'
import { OutboxRelayService } from './outbox-relay.service.js'
import { RetryRelayService } from './retry-relay.service.js'

@Module({
  imports: [
    ScheduleModule.forRoot(),
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
  providers: [OutboxRelayService, RetryRelayService],
})
export class OutboxModule {}
