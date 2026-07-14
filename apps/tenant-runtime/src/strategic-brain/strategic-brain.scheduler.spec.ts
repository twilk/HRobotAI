import { Test, TestingModule } from '@nestjs/testing'
import { TenantPrismaManager } from '@hrobot/db'
import { StrategicBrainScheduler } from './strategic-brain.scheduler.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { SnapshotService } from './snapshot.service.js'
import { RecommendationService } from './recommendation.service.js'
import { PerformanceConfigService } from './performance-config.service.js'

/**
 * `StrategicBrainScheduler` (spec §5, §14 B4/M14; plan Task 8).
 *
 * Mocks every collaborator: `ControlPlanePrismaService` (tenant enumeration), `TenantPrismaManager`
 * (per-tenant client borrow, mirrors `TenantContextInterceptor`'s real usage), the per-tenant
 * `TenantClient.$transaction` + `$queryRaw` (advisory lock), and the three `strategic-brain`
 * services the scheduler orchestrates. No scoring logic is re-tested here — only the
 * lock-skip / invocation-order / per-tenant-isolation orchestration contract.
 */

function makeTxClient(locked: boolean) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ locked }]),
    employee: { findMany: jest.fn().mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]) },
    lokalizacja: { findMany: jest.fn().mockResolvedValue([{ id: 'lok-1' }]) },
  }
}
type MockTxClient = ReturnType<typeof makeTxClient>

function makeTenantClient(txClient: MockTxClient) {
  return {
    $transaction: jest.fn((cb: (tx: MockTxClient) => unknown) => cb(txClient)),
  }
}

const mockControlPlanePrisma = {
  tenant: { findMany: jest.fn() },
}

const mockTenantManager = {
  withClient: jest.fn(),
}

const mockSnapshotService = {
  computeSnapshot: jest.fn(),
}

const mockRecommendationService = {
  finalizeWindow: jest.fn(),
  emitRetention: jest.fn(),
  emitRecruitment: jest.fn(),
}

const mockConfigService = {
  getEffectiveConfig: jest.fn(),
}

describe('StrategicBrainScheduler', () => {
  let scheduler: StrategicBrainScheduler

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategicBrainScheduler,
        { provide: ControlPlanePrismaService, useValue: mockControlPlanePrisma },
        { provide: TenantPrismaManager, useValue: mockTenantManager },
        { provide: SnapshotService, useValue: mockSnapshotService },
        { provide: RecommendationService, useValue: mockRecommendationService },
        { provide: PerformanceConfigService, useValue: mockConfigService },
      ],
    }).compile()
    scheduler = module.get(StrategicBrainScheduler)

    jest.clearAllMocks()
    mockConfigService.getEffectiveConfig.mockResolvedValue({ windowDays: 14 })
    mockRecommendationService.emitRetention.mockResolvedValue([])
    mockRecommendationService.emitRecruitment.mockResolvedValue({ verdict: 'WSTRZYMAJ' })
  })

  it('skips a tenant when pg_try_advisory_xact_lock does not acquire the lock — no work, no double-run', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }])
    const txClient = makeTxClient(false)
    const client = makeTenantClient(txClient)
    mockTenantManager.withClient.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(client))

    await scheduler.run()

    expect(txClient.$queryRaw).toHaveBeenCalledTimes(1)
    expect(txClient.employee.findMany).not.toHaveBeenCalled()
    expect(txClient.lokalizacja.findMany).not.toHaveBeenCalled()
    expect(mockSnapshotService.computeSnapshot).not.toHaveBeenCalled()
    expect(mockRecommendationService.finalizeWindow).not.toHaveBeenCalled()
    expect(mockRecommendationService.emitRetention).not.toHaveBeenCalled()
    expect(mockRecommendationService.emitRecruitment).not.toHaveBeenCalled()
  })

  it('when the lock IS acquired, runs computeSnapshot (per employee) → finalizeWindow → emitRetention → emitRecruitment (per location), in that order', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1' }])
    const txClient = makeTxClient(true)
    const client = makeTenantClient(txClient)
    mockTenantManager.withClient.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(client))

    await scheduler.run()

    expect(txClient.$queryRaw).toHaveBeenCalledTimes(1)
    expect(txClient.employee.findMany).toHaveBeenCalledTimes(1)
    expect(mockSnapshotService.computeSnapshot).toHaveBeenCalledTimes(2)
    expect(mockSnapshotService.computeSnapshot).toHaveBeenNthCalledWith(1, txClient, 'emp-1', expect.any(Object))
    expect(mockSnapshotService.computeSnapshot).toHaveBeenNthCalledWith(2, txClient, 'emp-2', expect.any(Object))

    expect(mockRecommendationService.finalizeWindow).toHaveBeenCalledTimes(1)
    expect(mockRecommendationService.finalizeWindow).toHaveBeenCalledWith(txClient, expect.any(Object))

    expect(mockRecommendationService.emitRetention).toHaveBeenCalledTimes(1)
    expect(mockRecommendationService.emitRetention).toHaveBeenCalledWith(txClient, expect.any(Object))

    expect(txClient.lokalizacja.findMany).toHaveBeenCalledTimes(1)
    expect(mockRecommendationService.emitRecruitment).toHaveBeenCalledTimes(1)
    expect(mockRecommendationService.emitRecruitment).toHaveBeenCalledWith(
      txClient,
      { scopeType: 'LOKALIZACJA', scopeId: 'lok-1' },
      expect.any(Date),
    )

    // Orchestration order: every computeSnapshot call precedes finalizeWindow, which precedes
    // emitRetention, which precedes emitRecruitment.
    const snapshotOrders = mockSnapshotService.computeSnapshot.mock.invocationCallOrder as number[]
    const finalizeOrder = (mockRecommendationService.finalizeWindow.mock.invocationCallOrder as number[])[0] as number
    const retentionOrder = (mockRecommendationService.emitRetention.mock.invocationCallOrder as number[])[0] as number
    const recruitmentOrder = (mockRecommendationService.emitRecruitment.mock.invocationCallOrder as number[])[0] as number

    expect(Math.max(...snapshotOrders)).toBeLessThan(finalizeOrder)
    expect(finalizeOrder).toBeLessThan(retentionOrder)
    expect(retentionOrder).toBeLessThan(recruitmentOrder)
  })

  it('does not abort other tenants when one tenant run throws — best-effort per-tenant', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-bad' }, { id: 'tenant-good' }])

    const goodTx = makeTxClient(true)
    const goodClient = makeTenantClient(goodTx)

    mockTenantManager.withClient.mockImplementation((id: string, fn: (c: unknown) => unknown) => {
      if (id === 'tenant-bad') throw new Error('boom: cannot resolve tenant db url')
      return fn(goodClient)
    })

    await expect(scheduler.run()).resolves.toBeUndefined()

    // The bad tenant errored, but the good tenant still ran to completion.
    expect(goodTx.employee.findMany).toHaveBeenCalledTimes(1)
    expect(mockSnapshotService.computeSnapshot).toHaveBeenCalledTimes(2)
    expect(mockRecommendationService.finalizeWindow).toHaveBeenCalledTimes(1)
    expect(mockRecommendationService.emitRetention).toHaveBeenCalledTimes(1)
    expect(mockRecommendationService.emitRecruitment).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there are no active tenants', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([])

    await scheduler.run()

    expect(mockTenantManager.withClient).not.toHaveBeenCalled()
    expect(mockSnapshotService.computeSnapshot).not.toHaveBeenCalled()
  })
})
