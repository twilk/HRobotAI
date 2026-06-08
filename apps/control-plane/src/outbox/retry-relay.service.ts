import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

/**
 * C1: durable provisioning retry. ProvisioningService stamps `next_attempt_at` on a failed step
 * (instead of an in-process setTimeout that is lost on pod restart). This cron re-enqueues jobs
 * whose time is due. State lives in Postgres, so retries survive restarts/deploys; FOR UPDATE
 * SKIP LOCKED makes it safe to run on multiple API pods without double-enqueue.
 */
@Injectable()
export class RetryRelayService {
  private readonly logger = new Logger(RetryRelayService.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('TENANT_PROVISION_CLIENT') private readonly client: ClientProxy,
  ) {}

  @Cron('*/10 * * * * *') // every 10 seconds
  async reEnqueueDue(): Promise<void> {
    // Atomically claim due jobs (clear next_attempt_at) so two pods never re-enqueue the same one.
    const due = await this.prisma.$queryRaw<Array<{ id: string; tenantId: string }>>`
      UPDATE provisioning_jobs SET next_attempt_at = NULL
      WHERE id IN (
        SELECT id FROM provisioning_jobs
        WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= now()
          AND step NOT IN ('DONE', 'FAILED')
        ORDER BY next_attempt_at LIMIT 50 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id AS "tenantId"
    `

    for (const job of due) {
      try {
        await firstValueFrom(
          this.client.emit('tenant.provision', { jobId: job.id, tenantId: job.tenantId }),
        )
      } catch (err) {
        // Re-arm a near-future attempt so a failed re-enqueue is retried next tick.
        this.logger.error({ err, jobId: job.id }, 'Failed to re-enqueue provisioning retry; re-arming')
        await this.prisma.provisioningJob.update({
          where: { id: job.id },
          data: { nextAttemptAt: new Date(Date.now() + 10_000) },
        })
      }
    }
  }
}
