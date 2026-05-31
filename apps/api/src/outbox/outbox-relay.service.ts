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
    // C3: atomically CLAIM up to 50 pending events with FOR UPDATE SKIP LOCKED so multiple API
    // pods running this cron never grab the same row (was: plain findMany → multi-pod double-publish).
    const events = await this.prisma.$queryRaw<
      Array<{ id: string; routingKey: string; payload: Record<string, unknown> }>
    >`
      UPDATE outbox_events SET published_at = now()
      WHERE id IN (
        SELECT id FROM outbox_events WHERE published_at IS NULL
        ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, routing_key AS "routingKey", payload
    `

    for (const event of events) {
      try {
        await firstValueFrom(this.client.emit(event.routingKey, event.payload))
      } catch (err) {
        // Emit failed after claim — release the claim so it retries next tick. The provisioning
        // consumer is idempotent, so an occasional duplicate delivery is safe.
        this.logger.error({ err, eventId: event.id }, 'Failed to publish outbox event; releasing claim')
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: null },
        })
      }
    }
  }
}
