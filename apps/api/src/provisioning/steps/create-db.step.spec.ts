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

  it('creates the role and database when neither exists', async () => {
    await step.execute(job)
    const sql = mockPg.query.mock.calls.map((c) => String(c[0]))
    expect(sql.some((s) => /CREATE ROLE/.test(s))).toBe(true)
    expect(sql.some((s) => /CREATE DATABASE/.test(s))).toBe(true)
  })

  it('is idempotent on retry: ALTERs an existing role and skips an existing database', async () => {
    // pg_roles / pg_database existence checks return a row → resource already exists
    mockPg.query.mockImplementation((sql: string) =>
      /pg_roles|pg_database/.test(sql)
        ? Promise.resolve({ rows: [{ exists: 1 }] })
        : Promise.resolve({ rows: [] }),
    )
    await step.execute(job)
    const sql = mockPg.query.mock.calls.map((c) => String(c[0]))
    expect(sql.some((s) => /ALTER ROLE/.test(s))).toBe(true)
    expect(sql.some((s) => /CREATE DATABASE/.test(s))).toBe(false)
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
