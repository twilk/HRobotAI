import { Test, TestingModule } from '@nestjs/testing'
import { of, throwError } from 'rxjs'
import { RetryRelayService } from './retry-relay.service.js'
import { CLAIM_LEASE_MS } from '../provisioning/provisioning.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

const mockPrisma = {
  $queryRaw: jest.fn(),
  provisioningJob: { update: jest.fn() },
}

const mockClient = {
  emit: jest.fn().mockReturnValue(of(null)),
}

describe('RetryRelayService', () => {
  let service: RetryRelayService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetryRelayService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'TENANT_PROVISION_CLIENT', useValue: mockClient },
      ],
    }).compile()
    service = module.get(RetryRelayService)
    jest.clearAllMocks()
  })

  it('re-enqueues claimed due jobs to RabbitMQ', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'job-1', tenantId: 'tenant-1' }])

    await service.reEnqueueDue()

    expect(mockClient.emit).toHaveBeenCalledWith('tenant.provision', {
      jobId: 'job-1',
      tenantId: 'tenant-1',
    })
  })

  it('does nothing when no jobs are due', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([])
    await service.reEnqueueDue()
    expect(mockClient.emit).not.toHaveBeenCalled()
  })

  /**
   * G-1: a consumer that acked a message and then died mid-step leaves claimed_at set and
   * next_attempt_at NULL — RabbitMQ will not redeliver it, so nothing else would ever notice.
   * The sweep must treat an EXPIRED lease as due. (The SQL itself is verified against real
   * Postgres: an abandoned and an armed row are selected, a freshly claimed one is not.)
   */
  it('also sweeps jobs whose claim lease expired, using the lease length from ProvisioningService', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([])

    await service.reEnqueueDue()

    const [fragments, ...values] = mockPrisma.$queryRaw.mock.calls[0] as [string[], ...number[]]
    const sql = fragments.join('?')
    expect(sql).toContain('claimed_at IS NOT NULL')
    expect(sql).toContain('make_interval')
    // Bound as a parameter, not interpolated, and derived from the single source of truth.
    expect(values).toEqual([CLAIM_LEASE_MS / 1000])
    // Terminal jobs are still excluded.
    expect(sql).toContain("step NOT IN ('DONE', 'FAILED')")
  })

  it('re-arms a near-future nextAttemptAt when re-enqueue fails', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'job-1', tenantId: 'tenant-1' }])
    mockClient.emit.mockReturnValueOnce(throwError(() => new Error('RMQ down')))

    await service.reEnqueueDue()

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { nextAttemptAt: expect.any(Date) as Date },
    })
  })
})
