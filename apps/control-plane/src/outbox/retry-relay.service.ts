import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { CLAIM_LEASE_MS } from '../provisioning/provisioning.service.js'

/**
 * C1: durable provisioning retry. ProvisioningService stamps `next_attempt_at` on a failed step
 * (instead of an in-process setTimeout that is lost on pod restart). This cron re-enqueues jobs
 * whose time is due. State lives in Postgres, so retries survive restarts/deploys; FOR UPDATE
 * SKIP LOCKED makes it safe to run on multiple API pods without double-enqueue.
 *
 * G-1: it also sweeps ABANDONED CLAIMS. A consumer that acked a message and then died mid-step
 * leaves `claimed_at` set and `next_attempt_at` NULL — RabbitMQ will not redeliver (it was acked)
 * and nothing else was watching, so before this the job was stranded silently. An expired lease
 * is by definition abandoned, so it is due. Re-enqueueing an abandoned job is safe even if two
 * pods do it at once: the consumer's compare-and-set claim lets exactly one of them proceed.
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
    const leaseSeconds = CLAIM_LEASE_MS / 1000
    const due = await this.prisma.$queryRaw<Array<{ id: string; tenantId: string }>>`
      UPDATE provisioning_jobs SET next_attempt_at = NULL
      WHERE id IN (
        SELECT id FROM provisioning_jobs
        WHERE step NOT IN ('DONE', 'FAILED')
          AND (
            -- an armed retry whose time has come (C1)
            (next_attempt_at IS NOT NULL AND next_attempt_at <= now())
            -- …or a lease nobody released: the consumer holding this step died (G-1). Note this
            -- branch leaves claimed_at alone — the consumer's compare-and-set retakes the expired
            -- lease, and until it does the row stays visible here, so the sweep is self-healing.
            OR (claimed_at IS NOT NULL AND claimed_at <= now() - make_interval(secs => ${leaseSeconds}))
          )
        ORDER BY COALESCE(next_attempt_at, claimed_at) LIMIT 50 FOR UPDATE SKIP LOCKED
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
