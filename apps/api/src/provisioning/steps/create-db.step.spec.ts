import { Test, TestingModule } from '@nestjs/testing'
import { CreateDbStep } from './create-db.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const mockPg = { query: jest.fn() }

const testKey = Buffer.from('a'.repeat(64), 'hex')
const encryption = new EncryptionService(testKey)

const job = {
  id: 'job-1',
  tenantId: 'tenant-1',
  step: ProvisioningStep.CREATE_DB,
  attemptCount: 0,
}

const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  metadata: { adminEmail: 'admin@acme.com' },
}

describe('CreateDbStep', () => {
  let step: CreateDbStep

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateDbStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'SUPERUSER_PG_CLIENT', useValue: mockPg },
        { provide: EncryptionService, useValue: encryption },
        { provide: 'POSTGRES_HOST', useValue: 'localhost' },
        { provide: 'POSTGRES_PORT', useValue: '5433' },
      ],
    }).compile()
    step = module.get(CreateDbStep)
    jest.clearAllMocks()
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue(tenant)
    mockPg.query.mockResolvedValue({ rows: [] })
    mockPrisma.tenant.update.mockResolvedValue({})
    mockPrisma.provisioningJob.update.mockResolvedValue({})
  })

  it('executes CREATE USER and CREATE DATABASE SQL', async () => {
    await step.execute(job)
    expect(mockPg.query).toHaveBeenCalledTimes(2)
    const calls = mockPg.query.mock.calls as [[string], [string]]
    expect(calls[0]![0]).toMatch(/CREATE USER/)
    expect(calls[1]![0]).toMatch(/CREATE DATABASE/)
  })

  it('stores an encrypted db_url in tenants and advances step to RUN_MIGRATIONS', async () => {
    await step.execute(job)

    const tenantUpdateCall = mockPrisma.tenant.update.mock.calls[0]?.[0] as {
      data: { dbUrl: string }
    }
    const encryptedUrl = tenantUpdateCall.data.dbUrl
    // Must be base64 (encrypted), not plaintext
    expect(encryptedUrl).not.toMatch(/^postgresql:\/\//)
    // Must decrypt back to a valid URL
    const decrypted = encryption.decrypt(encryptedUrl)
    expect(decrypted).toMatch(/^postgresql:\/\//)

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.RUN_MIGRATIONS },
    })
  })
})
