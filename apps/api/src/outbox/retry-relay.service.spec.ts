import { Test, TestingModule } from '@nestjs/testing'
import { of, throwError } from 'rxjs'
import { RetryRelayService } from './retry-relay.service.js'
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
