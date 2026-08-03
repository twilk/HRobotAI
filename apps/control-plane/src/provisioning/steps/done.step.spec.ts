import { Test, TestingModule } from '@nestjs/testing'
import { DoneStep } from './done.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { ProvisioningStep, TenantStatus } from '@hrobot/shared'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const job = { id: 'job-1', tenantId: 'tenant-1', step: ProvisioningStep.DONE, attemptCount: 0 }

describe('DoneStep', () => {
  let step: DoneStep

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DoneStep, { provide: ControlPlanePrismaService, useValue: mockPrisma }],
    }).compile()
    step = module.get(DoneStep)
    jest.clearAllMocks()
    mockPrisma.tenant.update.mockResolvedValue({})
    mockPrisma.provisioningJob.update.mockResolvedValue({})
  })

  it('flips the tenant to ACTIVE and stamps provisionedAt on first run', async () => {
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ id: 'tenant-1', provisionedAt: null })

    await step.execute(job)

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { status: TenantStatus.ACTIVE, provisionedAt: expect.any(Date) as Date },
    })
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.DONE },
    })
  })

  /**
   * G-1: DoneStep is the one step that legitimately re-enters itself (it leaves step=DONE, so a
   * redelivered message dispatches to it again). Overwriting provisionedAt would silently move
   * the tenant's activation date forward — it feeds trial/billing windows and the audit trail.
   * Fails without the "keep the first timestamp" guard.
   */
  it('preserves the ORIGINAL provisionedAt when re-run by a redelivered message', async () => {
    const original = new Date('2026-01-01T10:00:00.000Z')
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ id: 'tenant-1', provisionedAt: original })

    await step.execute(job)

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { status: TenantStatus.ACTIVE },
    })
    const data = (mockPrisma.tenant.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data
    expect(data).not.toHaveProperty('provisionedAt')
  })
})
