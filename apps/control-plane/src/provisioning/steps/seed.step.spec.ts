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
})
