import { Inject, Injectable, Logger } from '@nestjs/common'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { TransientProvisioningError } from './provisioning-errors.js'

export interface ProvisioningStepHandler {
  execute(job: {
    id: string
    tenantId: string
    step: string
    attemptCount: number
  }): Promise<void>
}

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const

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

    try {
      await handler.execute(job)
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err)
      // Strip credentials before persisting: lastError can carry the tenant DATABASE_URL
      // (with password) from e.g. prisma migrate stderr, and is read by ops tooling.
      const message = raw
        .replace(/postgresql:\/\/[^@\s]*@/gi, 'postgresql://***@')
        .replace(/Bearer\s+[\w.-]+/gi, 'Bearer ***')

      // Infrastructure-not-ready errors (e.g., Keycloak still initializing) must not consume
      // a retry attempt — the 3-attempt budget is for real failures, not startup race conditions.
      // Retry after 30 s. If a dependency is permanently broken an operator must mark the job
      // FAILED manually.
      if (err instanceof TransientProvisioningError) {
        await this.prisma.provisioningJob.update({
          where: { id: job.id },
          data: { lastError: message, nextAttemptAt: new Date(Date.now() + 30_000) },
        })
        this.logger.warn({ jobId: job.id }, 'Transient provisioning error — retrying without consuming attempt')
        return
      }

      const nextAttempt = job.attemptCount + 1

      if (nextAttempt >= 3) {
        this.logger.error({ jobId: job.id, err }, 'Provisioning permanently failed after 3 attempts')
        await this.prisma.provisioningJob.update({
          where: { id: job.id },
          data: { step: ProvisioningStep.FAILED, lastError: message, attemptCount: nextAttempt },
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
        },
      })
      this.logger.warn({ jobId: job.id, delayMs }, 'Scheduled durable retry')
    }
  }
}
