import { Test, TestingModule } from '@nestjs/testing'
import { CLAIM_LEASE_MS, ProvisioningService } from './provisioning.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { ProvisioningStep } from '@hrobot/shared'

interface JobRow {
  id: string
  tenantId: string
  step: string
  attemptCount: number
  lastError: string | null
  claimedAt: Date | null
  nextAttemptAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const makeJob = (step: string, overrides: Partial<JobRow> = {}): JobRow => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  step,
  attemptCount: 0,
  lastError: null,
  claimedAt: null,
  nextAttemptAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const mockSteps = {
  createDb: { execute: jest.fn() },
  runMigrations: { execute: jest.fn() },
  seed: { execute: jest.fn() },
  keycloakSetup: { execute: jest.fn() },
  done: { execute: jest.fn() },
}

/**
 * G-1: an in-memory provisioning_jobs table that models the ONE property the claim relies on —
 * a single `UPDATE ... WHERE <predicate>` evaluates its predicate and writes atomically.
 *
 * That is faithful here: an async function body runs synchronously up to its first `await`, and
 * `updateMany` below has none, so two concurrent callers can never interleave inside it. This is
 * the JS analogue of the row lock Postgres takes for the same statement.
 */
function makeJobStore(initial: JobRow) {
  let row: JobRow = { ...initial }

  type ClaimWhere = {
    id: string
    step: string
    OR?: Array<{ claimedAt: null | { lt: Date } }>
  }

  return {
    current: (): JobRow => ({ ...row }),
    prisma: {
      provisioningJob: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === row.id ? { ...row } : null,
        ),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<JobRow> }) => {
          if (where.id !== row.id) throw new Error('no such job')
          row = { ...row, ...data }
          return { ...row }
        }),
        updateMany: jest.fn(
          async ({ where, data }: { where: ClaimWhere; data: Partial<JobRow> }) => {
            const leaseFree =
              where.OR === undefined ||
              where.OR.some((clause) =>
                clause.claimedAt === null
                  ? row.claimedAt === null
                  : row.claimedAt !== null && row.claimedAt < clause.claimedAt.lt,
              )
            if (row.id !== where.id || row.step !== where.step || !leaseFree) return { count: 0 }
            row = { ...row, ...data }
            return { count: 1 }
          },
        ),
      },
    },
  }
}

async function buildService(prisma: unknown): Promise<ProvisioningService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProvisioningService,
      { provide: ControlPlanePrismaService, useValue: prisma },
      { provide: 'CREATE_DB_STEP', useValue: mockSteps.createDb },
      { provide: 'RUN_MIGRATIONS_STEP', useValue: mockSteps.runMigrations },
      { provide: 'SEED_STEP', useValue: mockSteps.seed },
      { provide: 'KEYCLOAK_SETUP_STEP', useValue: mockSteps.keycloakSetup },
      { provide: 'DONE_STEP', useValue: mockSteps.done },
    ],
  }).compile()
  return module.get(ProvisioningService)
}

const msg = { jobId: 'job-1', tenantId: 'tenant-1' }

describe('ProvisioningService', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('step dispatch and failure handling', () => {
    const mockPrisma = {
      provisioningJob: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    }
    let service: ProvisioningService

    beforeEach(async () => {
      service = await buildService(mockPrisma)
      mockPrisma.provisioningJob.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.provisioningJob.update.mockResolvedValue(makeJob(ProvisioningStep.CREATE_DB))
    })

    it('dispatches to CREATE_DB step when job.step is CREATE_DB', async () => {
      const job = makeJob(ProvisioningStep.CREATE_DB)
      mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
      mockSteps.createDb.execute.mockResolvedValue(undefined)

      await service.process(msg)

      expect(mockSteps.createDb.execute).toHaveBeenCalledWith(job)
      expect(mockSteps.runMigrations.execute).not.toHaveBeenCalled()
    })

    it('stamps a durable nextAttemptAt and releases the claim on step failure (attemptCount < 3)', async () => {
      const job = makeJob(ProvisioningStep.CREATE_DB, { attemptCount: 0 })
      mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
      mockSteps.createDb.execute.mockRejectedValue(new Error('DB error'))

      await service.process(msg)

      // Durable retry: persist attemptCount + a future nextAttemptAt; RetryRelay re-enqueues it.
      // claimedAt is released so the retry can take the step immediately, not after the lease.
      expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          attemptCount: 1,
          lastError: 'DB error',
          nextAttemptAt: expect.any(Date) as Date,
          claimedAt: null,
        },
      })
    })

    it('sets step=FAILED when attemptCount reaches 3', async () => {
      const job = makeJob(ProvisioningStep.CREATE_DB, { attemptCount: 2 })
      mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
      mockSteps.createDb.execute.mockRejectedValue(new Error('still broken'))

      await service.process(msg)

      expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          step: ProvisioningStep.FAILED,
          lastError: 'still broken',
          attemptCount: 3,
          claimedAt: null,
        },
      })
      // FAILED is terminal — no nextAttemptAt set, so RetryRelay will not pick it up.
    })
  })

  /**
   * G-1: RabbitMQ delivers `tenant.provision` AT-LEAST-ONCE. These specs pin the PROPERTY —
   * "processing the same message twice leaves the same end state and creates no duplicates" —
   * not the happy path. Each of the first two fails without the compare-and-set claim.
   */
  describe('at-least-once redelivery', () => {
    it('executes a step exactly once when the same message is delivered twice CONCURRENTLY', async () => {
      const store = makeJobStore(makeJob(ProvisioningStep.CREATE_DB))
      const service = await buildService(store.prisma)

      // A real step does I/O, so both deliveries are genuinely in flight at the same time.
      mockSteps.createDb.execute.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        await store.prisma.provisioningJob.update({
          where: { id: 'job-1' },
          data: { step: ProvisioningStep.RUN_MIGRATIONS },
        })
      })

      await Promise.all([service.process(msg), service.process(msg)])

      // The property: one execution, not two. Without the claim BOTH deliveries run the step —
      // SeedStep would create a second "Cała firma", CreateDbStep would cross two password rotations.
      expect(mockSteps.createDb.execute).toHaveBeenCalledTimes(1)
      // …and the end state is exactly the single-delivery end state.
      expect(store.current().step).toBe(ProvisioningStep.RUN_MIGRATIONS)
      expect(store.current().claimedAt).toBeNull()
      // The retry the loser armed is cleared by the winner's success — no spurious re-enqueue.
      expect(store.current().nextAttemptAt).toBeNull()
    })

    it('does not re-run a step held by a live claim, and arms a durable retry so a crashed holder is recovered', async () => {
      // Another consumer claimed this step 1 s ago and has not finished (or died mid-step).
      const claimedAt = new Date(Date.now() - 1_000)
      const store = makeJobStore(makeJob(ProvisioningStep.SEED, { claimedAt }))
      const service = await buildService(store.prisma)

      await service.process(msg)

      expect(mockSteps.seed.execute).not.toHaveBeenCalled()
      // This delivery is about to be ACKed, so it must not be dropped silently: arm a retry just
      // past the lease so RetryRelay picks the job up if the holder never finishes.
      const armed = store.current().nextAttemptAt
      expect(armed).not.toBeNull()
      expect(armed!.getTime()).toBeGreaterThan(claimedAt.getTime() + CLAIM_LEASE_MS)
      // The holder's claim is left untouched.
      expect(store.current().claimedAt).toEqual(claimedAt)
    })

    it('retakes an EXPIRED claim (the previous holder crashed) instead of stranding the job', async () => {
      const store = makeJobStore(
        makeJob(ProvisioningStep.SEED, { claimedAt: new Date(Date.now() - CLAIM_LEASE_MS - 1_000) }),
      )
      const service = await buildService(store.prisma)
      mockSteps.seed.execute.mockResolvedValue(undefined)

      await service.process(msg)

      expect(mockSteps.seed.execute).toHaveBeenCalledTimes(1)
      expect(store.current().claimedAt).toBeNull()
    })

    it('drops a duplicate whose step already advanced, without re-arming a retry', async () => {
      // Delivery for CREATE_DB arrives after another consumer already moved the job on.
      const store = makeJobStore(makeJob(ProvisioningStep.RUN_MIGRATIONS))
      const service = await buildService(store.prisma)
      mockSteps.runMigrations.execute.mockImplementation(async () => {
        await store.prisma.provisioningJob.updateMany({
          // simulate a competing claim already held on the CURRENT step
          where: { id: 'job-1', step: ProvisioningStep.RUN_MIGRATIONS },
          data: { step: ProvisioningStep.SEED },
        })
      })

      await service.process(msg)

      expect(mockSteps.runMigrations.execute).toHaveBeenCalledTimes(1)
      expect(store.current().step).toBe(ProvisioningStep.SEED)
      expect(store.current().nextAttemptAt).toBeNull()
    })
  })
})
