import { Test, TestingModule } from '@nestjs/testing'
import { of } from 'rxjs'
import { OutboxRelayService } from './outbox-relay.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

const pendingEvent = {
  id: 'evt-1',
  exchange: 'tenant.provision',
  routingKey: 'tenant.provision',
  payload: { jobId: 'job-1', tenantId: 'tenant-1' },
  publishedAt: null,
  createdAt: new Date(),
}

const mockPrisma = {
  outboxEvent: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
}

const mockClient = {
  emit: jest.fn().mockReturnValue(of(null)),
}

describe('OutboxRelayService', () => {
  let service: OutboxRelayService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxRelayService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'TENANT_PROVISION_CLIENT', useValue: mockClient },
      ],
    }).compile()
    service = module.get(OutboxRelayService)
    jest.clearAllMocks()
  })

  it('emits pending events to RabbitMQ and marks them published', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([pendingEvent])
    mockPrisma.outboxEvent.update.mockResolvedValue({ ...pendingEvent, publishedAt: new Date() })

    await service.publishPending()

    expect(mockClient.emit).toHaveBeenCalledWith('tenant.provision', {
      jobId: 'job-1',
      tenantId: 'tenant-1',
    })
    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { publishedAt: expect.any(Date) as Date },
    })
  })

  it('does nothing when there are no pending events', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([])
    await service.publishPending()
    expect(mockClient.emit).not.toHaveBeenCalled()
  })
})
