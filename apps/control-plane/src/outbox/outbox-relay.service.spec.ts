import { Test, TestingModule } from '@nestjs/testing'
import { of, throwError } from 'rxjs'
import { OutboxRelayService } from './outbox-relay.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

const claimedEvent = {
  id: 'evt-1',
  routingKey: 'tenant.provision',
  payload: { jobId: 'job-1', tenantId: 'tenant-1' },
}

const mockPrisma = {
  // C3: the relay now claims rows via a raw FOR UPDATE SKIP LOCKED UPDATE ... RETURNING.
  $queryRaw: jest.fn(),
  outboxEvent: {
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

  it('claims pending events with SKIP LOCKED and emits them (no extra update on success)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([claimedEvent])

    await service.publishPending()

    expect(mockClient.emit).toHaveBeenCalledWith('tenant.provision', {
      jobId: 'job-1',
      tenantId: 'tenant-1',
    })
    // the claim already set published_at; the success path issues no further update
    expect(mockPrisma.outboxEvent.update).not.toHaveBeenCalled()
  })

  it('does nothing when there are no pending events', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([])
    await service.publishPending()
    expect(mockClient.emit).not.toHaveBeenCalled()
  })

  it('releases the claim (re-null published_at) when emit fails so it retries', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([claimedEvent])
    mockClient.emit.mockReturnValueOnce(throwError(() => new Error('RMQ down')))

    await service.publishPending()

    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { publishedAt: null },
    })
  })
})
