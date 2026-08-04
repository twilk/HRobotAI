import { Test, TestingModule } from '@nestjs/testing'
import { SeedStep } from './seed.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'

const testKey = Buffer.from('a'.repeat(64), 'hex')
const encryption = new EncryptionService(testKey)

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const mockTenantClient = {
  organizationalUnit: { create: jest.fn(), findFirst: jest.fn() },
  $queryRawUnsafe: jest.fn(),
  $disconnect: jest.fn(),
}

const job = { id: 'job-1', tenantId: 'tenant-1', step: ProvisioningStep.SEED, attemptCount: 0 }

describe('SeedStep', () => {
  let step: SeedStep

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeedStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: 'TENANT_CLIENT_FACTORY', useValue: (_url: string) => mockTenantClient },
      ],
    }).compile()
    step = module.get(SeedStep)
    jest.clearAllMocks()
    mockPrisma.provisioningJob.update.mockResolvedValue({})
    mockTenantClient.organizationalUnit.create.mockResolvedValue({ id: 'unit-1' })
    mockTenantClient.organizationalUnit.findFirst.mockResolvedValue(null)
    mockTenantClient.$queryRawUnsafe.mockResolvedValue([])
    mockTenantClient.$disconnect.mockResolvedValue(undefined)
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({
      dbUrl: encryption.encrypt('postgresql://u:p@localhost:5433/db'),
    })
  })

  it('creates root OrganizationalUnit "Cała firma" and advances to KEYCLOAK_SETUP', async () => {
    await step.execute(job)

    expect(mockTenantClient.organizationalUnit.create).toHaveBeenCalledWith({
      data: { name: 'Cała firma', parentId: null },
    })
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.KEYCLOAK_SETUP },
    })
    expect(mockTenantClient.$disconnect).toHaveBeenCalled()
  })

  /**
   * G-1: the seed is the one step whose re-run was destructive even when strictly SEQUENTIAL
   * (unconditional create → a second root → two disjoint org trees). RabbitMQ is at-least-once,
   * so this is a normal delivery pattern, not a fault. Fails without the existence guard.
   */
  it('does not create a SECOND root unit when the tenant is already seeded (redelivered message)', async () => {
    mockTenantClient.organizationalUnit.findFirst.mockResolvedValue({ id: 'unit-1' })

    await step.execute(job)

    expect(mockTenantClient.organizationalUnit.create).not.toHaveBeenCalled()
    // Still advances: the step's post-condition holds, so the pipeline must keep moving.
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.KEYCLOAK_SETUP },
    })
  })

  it('is idempotent end-to-end: running it twice leaves exactly one root unit', async () => {
    const units: Array<{ id: string }> = []
    mockTenantClient.organizationalUnit.findFirst.mockImplementation(() =>
      Promise.resolve(units[0] ?? null),
    )
    mockTenantClient.organizationalUnit.create.mockImplementation(() => {
      const unit = { id: `unit-${units.length + 1}` }
      units.push(unit)
      return Promise.resolve(unit)
    })

    await step.execute(job)
    await step.execute(job)

    expect(units).toHaveLength(1)
  })

  /**
   * W4 — the check-then-act guard above ("a root already exists" ⇒ skip) is safe against a
   * SEQUENTIAL re-run, but NOT against a CONCURRENT one: both runs can read "absent" before
   * either writes. This models that race directly (not via ProvisioningService's step claim,
   * which W2 shows does not actually forbid two consumers from both being mid-execution of the
   * SAME step at once) with a tenant-DB client whose $queryRawUnsafe implements a REAL mutex
   * for `pg_advisory_lock`/`pg_advisory_unlock`, and a `findFirst` that mirrors the codebase's
   * own convention (competing-consumers.spec.ts) of inserting a real I/O window between the
   * check and the decision, so two concurrent calls are actually racing.
   *
   * THE PROPERTY: however many callers race to execute() the SAME job concurrently, at most one
   * root organizational unit is ever created.
   */
  it('creates only ONE root unit when two concurrent runs race for the same tenant (W4)', async () => {
    let locked = false
    const waiters: Array<() => void> = []
    const acquire = (): Promise<void> =>
      new Promise((resolve) => {
        if (!locked) {
          locked = true
          resolve()
          return
        }
        waiters.push(() => {
          locked = true
          resolve()
        })
      })
    const release = (): void => {
      const next = waiters.shift()
      if (next) next()
      else locked = false
    }

    const units: Array<{ id: string }> = []
    const raceyClient = {
      organizationalUnit: {
        findFirst: jest.fn(async () => {
          const current = units[0] ?? null
          // The real step's I/O window (mirrors competing-consumers.spec.ts) — without it, two
          // mock-backed calls can happen to fully serialize by coincidence and never race at all.
          await new Promise((resolve) => setTimeout(resolve, 10))
          return current
        }),
        create: jest.fn(async () => {
          const unit = { id: `unit-${units.length + 1}` }
          units.push(unit)
          return unit
        }),
      },
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (/pg_advisory_lock/.test(sql)) {
          await acquire()
        } else if (/pg_advisory_unlock/.test(sql)) {
          release()
        }
        return []
      }),
      $disconnect: jest.fn(async () => undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeedStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: 'TENANT_CLIENT_FACTORY', useValue: () => raceyClient },
      ],
    }).compile()
    const raceyStep = module.get<SeedStep>(SeedStep)

    await Promise.all([raceyStep.execute(job), raceyStep.execute(job), raceyStep.execute(job)])

    expect(units).toHaveLength(1)
  })
})
