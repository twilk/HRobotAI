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
  organizationalUnit: { create: jest.fn() },
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
    mockTenantClient.$disconnect.mockResolvedValue(undefined)
  })

  it('creates root OrganizationalUnit "Cała firma" and advances to KEYCLOAK_SETUP', async () => {
    const plainUrl = 'postgresql://u:p@localhost:5433/db'
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ dbUrl: encryption.encrypt(plainUrl) })

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
})
