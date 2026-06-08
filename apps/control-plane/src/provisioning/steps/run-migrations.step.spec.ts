import { Test, TestingModule } from '@nestjs/testing'
import { RunMigrationsStep } from './run-migrations.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'

const testKey = Buffer.from('a'.repeat(64), 'hex')
const encryption = new EncryptionService(testKey)

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const job = { id: 'job-1', tenantId: 'tenant-1', step: ProvisioningStep.RUN_MIGRATIONS, attemptCount: 0 }

describe('RunMigrationsStep', () => {
  let step: RunMigrationsStep
  let mockExec: jest.Mock

  beforeEach(async () => {
    mockExec = jest.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunMigrationsStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: 'EXEC_FILE', useValue: mockExec },
      ],
    }).compile()
    step = module.get(RunMigrationsStep)
    jest.clearAllMocks()
    mockPrisma.provisioningJob.update.mockResolvedValue({})
  })

  it('calls prisma migrate deploy with the decrypted DATABASE_URL', async () => {
    const plainUrl = 'postgresql://hu_abc:pw@localhost:5433/hrobot_t_abc'
    const encryptedUrl = encryption.encrypt(plainUrl)
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ dbUrl: encryptedUrl })

    await step.execute(job)

    // Invoked via the current node binary on the resolved Prisma CLI (not `pnpm`, whose shell
    // shim hangs when spawned on Windows). Assert the args carry migrate deploy + tenant schema.
    expect(mockExec).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = mockExec.mock.calls[0]
    expect(bin).toBe(process.execPath)
    expect(args).toEqual(
      expect.arrayContaining(['migrate', 'deploy', '--schema=packages/db/prisma/tenant/schema.prisma']),
    )
    expect(String(args[0])).toMatch(/prisma[\\/].*index\.js$/)
    expect(opts.env.DATABASE_URL).toBe(plainUrl)
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.SEED },
    })
  })

  it('throws (sanitized) when the migration command exits non-zero', async () => {
    const plainUrl = 'postgresql://hu_abc:pw@localhost:5433/hrobot_t_abc'
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({
      dbUrl: encryption.encrypt(plainUrl),
    })
    mockExec.mockRejectedValue(Object.assign(new Error('exit 1'), { stderr: 'migration error' }))

    await expect(step.execute(job)).rejects.toThrow('migration error')
  })
})
