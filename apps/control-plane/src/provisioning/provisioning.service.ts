import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

export interface ProvisioningStepHandler {
  execute(job: {
    id: string
    tenantId: string
    step: string
    attemptCount: number
  }): Promise<void>
}

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const

/**
 * G-1: how long a claimed step stays "in flight" before another consumer may retake it.
 * Must exceed the slowest step so a healthy consumer is never overtaken: RunMigrationsStep
 * spawns `prisma migrate deploy` with a 120 s timeout, so 5 min leaves ample head-room while
 * still bounding how long a crashed consumer can strand a job.
 */
export const CLAIM_LEASE_MS = 300_000

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('CREATE_DB_STEP') private readonly createDb: ProvisioningStepHandler,
    @Inject('RUN_MIGRATIONS_STEP') private readonly runMigrations: ProvisioningStepHandler,
    @Inject('SEED_STEP') private readonly seed: ProvisioningStepHandler,
    @Inject('KEYCLOAK_SETUP_STEP') private readonly keycloakSetup: ProvisioningStepHandler,
    @Inject('DONE_STEP') private readonly done: ProvisioningStepHandler,
    // Optional so unit specs (which don't register the RMQ client) still construct. In the
    // app it's the TENANT_PROVISION_CLIENT used to drive the pipeline one step at a time.
    @Optional() @Inject('TENANT_PROVISION_CLIENT') private readonly client?: ClientProxy,
  ) {}

  async process(msg: { jobId: string; tenantId: string }): Promise<void> {
    const job = await this.prisma.provisioningJob.findUnique({ where: { id: msg.jobId } })
    if (!job) {
      this.logger.warn({ jobId: msg.jobId }, 'Provisioning job not found — skipping')
      return
    }

    const stepMap: Record<string, ProvisioningStepHandler> = {
      [ProvisioningStep.CREATE_DB]: this.createDb,
      [ProvisioningStep.RUN_MIGRATIONS]: this.runMigrations,
      [ProvisioningStep.SEED]: this.seed,
      [ProvisioningStep.KEYCLOAK_SETUP]: this.keycloakSetup,
      [ProvisioningStep.DONE]: this.done,
    }

    const handler = stepMap[job.step]
    if (!handler) {
      this.logger.warn({ step: job.step }, 'No handler for step — skipping')
      return
    }

    // G-1: RabbitMQ is AT-LEAST-ONCE, so a duplicate delivery of this exact message is a normal
    // event, not a fault (consumer crash before ack, OutboxRelay releasing+re-publishing a claim,
    // RetryRelay re-enqueueing while the pipeline's own emit is still in flight). Without a claim
    // two consumers run the same step concurrently: SeedStep would create a second "Cała firma"
    // root, CreateDbStep would interleave two password rotations and leave the stored db_url out
    // of sync with the role. Claim the step FIRST; only the winner executes anything.
    if (!(await this.claimStep(job))) return

    try {
      await handler.execute(job)
      // Drive the pipeline forward: each step handler advances job.step in the DB but emits no
      // follow-up message, so without this the job stalls after one step. Re-emit so the consumer
      // runs the next step — INCLUDING the transition to DONE (DoneStep is what flips the tenant to
      // ACTIVE, so it must get its own message). Termination is guaranteed by `next !== job.step`:
      // KEYCLOAK_SETUP->DONE re-emits and DoneStep runs; DoneStep leaves step=DONE (unchanged), so
      // no further emit. FAILED is terminal too. emit() returns a cold Observable, so it MUST be
      // subscribed (firstValueFrom) or nothing is published.
      //
      // G-1: releasing the claim is part of the same write. It MUST happen before the emit below,
      // because the follow-up message races back in and has to be able to claim the NEXT step —
      // a still-held lease would make the winner block its own successor for CLAIM_LEASE_MS.
      // nextAttemptAt is cleared too: this attempt succeeded, so any retry armed by a contended
      // duplicate delivery (see claimStep) is now stale and must not fire.
      const after = await this.prisma.provisioningJob.update({
        where: { id: job.id },
        data: { claimedAt: null, nextAttemptAt: null },
      })
      const next = after?.step
      if (this.client && next && next !== job.step && next !== ProvisioningStep.FAILED) {
        await firstValueFrom(this.client.emit('tenant.provision', { jobId: job.id, tenantId: job.tenantId }))
        this.logger.log({ jobId: job.id, step: next }, 'Advancing provisioning to next step')
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err)
      // Strip credentials before persisting: lastError can carry the tenant DATABASE_URL
      // (with password) from e.g. prisma migrate stderr, and is read by ops tooling.
      const message = raw
        .replace(/postgresql:\/\/[^@\s]*@/gi, 'postgresql://***@')
        .replace(/Bearer\s+[\w.-]+/gi, 'Bearer ***')
      const nextAttempt = job.attemptCount + 1

      if (nextAttempt >= 3) {
        this.logger.error({ jobId: job.id, err }, 'Provisioning permanently failed after 3 attempts')
        await this.prisma.provisioningJob.update({
          where: { id: job.id },
          data: {
            step: ProvisioningStep.FAILED,
            lastError: message,
            attemptCount: nextAttempt,
            claimedAt: null,
          },
        })
        this.logger.error({ tenantId: job.tenantId }, 'ALERT: tenant provisioning failed permanently')
        return
      }

      // C1: persist a DURABLE next-attempt time instead of an in-process setTimeout (which is
      // lost on pod restart, stranding the job mid-pipeline). RetryRelay re-enqueues due jobs.
      const delayMs = RETRY_DELAYS_MS[job.attemptCount] ?? 600_000
      await this.prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          attemptCount: nextAttempt,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + delayMs),
          // G-1: release the claim so the scheduled retry can take it immediately instead of
          // waiting out the lease.
          claimedAt: null,
        },
      })
      this.logger.warn({ jobId: job.id, delayMs }, 'Scheduled durable retry')
    }
  }

  /**
   * G-1: compare-and-set the step claim. A single UPDATE takes a row lock in Postgres, so the
   * `(id, step, lease-free)` predicate is evaluated and the claim written atomically — exactly
   * one of N concurrent consumers can observe `count === 1`.
   *
   * Chosen over per-step idempotency alone because idempotency cannot fix CONCURRENT
   * interleavings (two CreateDbStep runs can still crossover their password rotation), and
   * because a single central invariant also covers steps added later. Per-step idempotency is
   * still kept as defence in depth for SeedStep/DoneStep, whose re-run is destructive even when
   * strictly sequential (after a lease expiry or a crash).
   */
  private async claimStep(job: { id: string; step: string; claimedAt: Date | null }): Promise<boolean> {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS)

    const claimed = await this.prisma.provisioningJob.updateMany({
      where: {
        id: job.id,
        // CAS: the step must not have moved since we read it…
        step: job.step as ProvisioningStep,
        // …and no live lease may be held. An expired lease is retaken (holder crashed).
        OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
      },
      data: { claimedAt: now },
    })
    if (claimed.count === 1) return true

    // Lost the race. Two distinguishable causes, and they need different handling:
    const fresh = await this.prisma.provisioningJob.findUnique({ where: { id: job.id } })
    const stillOnSameStep =
      fresh !== null &&
      fresh.step === job.step &&
      fresh.step !== ProvisioningStep.DONE &&
      fresh.step !== ProvisioningStep.FAILED

    if (stillOnSameStep) {
      // (a) another consumer holds a live lease on this same step. It may yet crash, and THIS
      // delivery is about to be acked — dropping it silently would strand the job. Arm a durable
      // retry just past the lease expiry: if the holder succeeds it clears nextAttemptAt (see the
      // success path above) and RetryRelay never fires; if it died, RetryRelay re-enqueues and the
      // now-expired lease is retaken.
      const leaseEnds = (fresh.claimedAt?.getTime() ?? now.getTime()) + CLAIM_LEASE_MS
      await this.prisma.provisioningJob.update({
        where: { id: job.id },
        data: { nextAttemptAt: new Date(leaseEnds + 1_000) },
      })
      this.logger.warn(
        { jobId: job.id, step: job.step },
        'Provisioning step already claimed by another consumer — skipping duplicate delivery, retry armed',
      )
      return false
    }

    // (b) the step already advanced (or reached DONE/FAILED): the other consumer finished and
    // emitted its own follow-up message. Nothing to do, and nothing to re-arm.
    this.logger.log(
      { jobId: job.id, step: job.step, currentStep: fresh?.step },
      'Provisioning step already completed by another consumer — dropping duplicate delivery',
    )
    return false
  }
}
