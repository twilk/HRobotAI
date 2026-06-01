import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('TENANT_PROVISION_CLIENT') private readonly client: ClientProxy,
  ) {}

  @Cron('*/5 * * * * *') // every 5 seconds
  async publishPending(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })

    for (const event of events) {
      try {
        await firstValueFrom(
          this.client.emit(event.routingKey, event.payload as Record<string, unknown>),
        )
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date() },
        })
      } catch (err) {
        this.logger.error({ err, eventId: event.id }, 'Failed to publish outbox event')
      }
    }
  }
}
