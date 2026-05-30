import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { of } from 'rxjs'
import { ProvisioningService } from './provisioning.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { ProvisioningStep } from '@hrobot/shared'

const makeJob = (step: string, attemptCount = 0) => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  step,
  attemptCount,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const mockSteps = {
  createDb: { execute: jest.fn() },
  runMigrations: { execute: jest.fn() },
  seed: { execute: jest.fn() },
  keycloakSetup: { execute: jest.fn() },
  done: { execute: jest.fn() },
}

const mockPrisma = {
  provisioningJob: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}

const mockClient = { emit: jest.fn().mockReturnValue(of(null)) }

describe('ProvisioningService', () => {
  let service: ProvisioningService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'TENANT_PROVISION_CLIENT', useValue: mockClient },
        { provide: 'CREATE_DB_STEP', useValue: mockSteps.createDb },
        { provide: 'RUN_MIGRATIONS_STEP', useValue: mockSteps.runMigrations },
        { provide: 'SEED_STEP', useValue: mockSteps.seed },
        { provide: 'KEYCLOAK_SETUP_STEP', useValue: mockSteps.keycloakSetup },
        { provide: 'DONE_STEP', useValue: mockSteps.done },
      ],
    }).compile()
    service = module.get(ProvisioningService)
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => { jest.useRealTimers() })

  it('dispatches to CREATE_DB step when job.step is CREATE_DB', async () => {
    const job = makeJob(ProvisioningStep.CREATE_DB)
    mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
    mockSteps.createDb.execute.mockResolvedValue(undefined)

    await service.process({ jobId: 'job-1', tenantId: 'tenant-1' })

    expect(mockSteps.createDb.execute).toHaveBeenCalledWith(job)
    expect(mockSteps.runMigrations.execute).not.toHaveBeenCalled()
  })

  it('increments attemptCount and re-enqueues on step failure (attemptCount < 3)', async () => {
    const job = makeJob(ProvisioningStep.CREATE_DB, 0)
    mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
    mockPrisma.provisioningJob.update.mockResolvedValue({ ...job, attemptCount: 1 })
    mockSteps.createDb.execute.mockRejectedValue(new Error('DB error'))

    await service.process({ jobId: 'job-1', tenantId: 'tenant-1' })

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { attemptCount: 1, lastError: 'DB error' },
    })
    // Re-enqueue scheduled — advance past first delay
    jest.runAllTimers()
    expect(mockClient.emit).toHaveBeenCalledWith('tenant.provision', {
      jobId: 'job-1',
      tenantId: 'tenant-1',
    })
  })

  it('sets step=FAILED when attemptCount reaches 3', async () => {
    const job = makeJob(ProvisioningStep.CREATE_DB, 2)
    mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
    mockPrisma.provisioningJob.update.mockResolvedValue({})
    mockSteps.createDb.execute.mockRejectedValue(new Error('still broken'))

    await service.process({ jobId: 'job-1', tenantId: 'tenant-1' })

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        step: ProvisioningStep.FAILED,
        lastError: 'still broken',
        attemptCount: 3,
      },
    })
    jest.runAllTimers()
    expect(mockClient.emit).not.toHaveBeenCalled()
  })
})
