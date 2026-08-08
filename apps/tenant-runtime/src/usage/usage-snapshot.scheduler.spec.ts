import { Test, TestingModule } from '@nestjs/testing'
import { TenantPrismaManager } from '@hrobot/db'
import { TenantStatus } from '@hrobot/shared'
import { UsageSnapshotScheduler, monthKey } from './usage-snapshot.scheduler.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

/**
 * `UsageSnapshotScheduler` (K7).
 *
 * Mocks the two collaborators the way `StrategicBrainScheduler`'s spec does: tenant enumeration via
 * `ControlPlanePrismaService`, per-tenant client borrow via `TenantPrismaManager.withClient`. What is
 * under test is the orchestration contract — only ACTIVE tenants, one upsert per tenant keyed by
 * (tenantId, month), and one failing tenant not costing the rest their number.
 */

const mockControlPlanePrisma = {
  tenant: { findMany: jest.fn() },
  tenantUsageSnapshot: { upsert: jest.fn() },
}

const mockTenantManager = {
  /** Mirrors the real borrow-scoped signature: withClient(tenantId, cb) invokes cb with a client. */
  withClient: jest.fn(),
}

describe('UsageSnapshotScheduler', () => {
  let scheduler: UsageSnapshotScheduler

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsageSnapshotScheduler,
        { provide: ControlPlanePrismaService, useValue: mockControlPlanePrisma },
        { provide: TenantPrismaManager, useValue: mockTenantManager },
      ],
    }).compile()
    scheduler = moduleRef.get(UsageSnapshotScheduler)
  })

  /** A tenant client whose employee.count() resolves to `n`. */
  function clientCounting(n: number) {
    return { employee: { count: jest.fn().mockResolvedValue(n) } }
  }

  it('captures headcount for every ACTIVE tenant, keyed by tenant and month', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([{ id: 't-1' }, { id: 't-2' }])
    mockTenantManager.withClient.mockImplementation(
      async (tenantId: string, cb: (c: ReturnType<typeof clientCounting>) => unknown) =>
        cb(clientCounting(tenantId === 't-1' ? 39 : 4)),
    )

    const captured = await scheduler.captureAll(new Date('2026-08-08T03:00:00Z'))

    expect(captured).toBe(2)
    // Only ACTIVE tenants are billable; a PENDING/SUSPENDED tenant has no seats to count.
    expect(mockControlPlanePrisma.tenant.findMany).toHaveBeenCalledWith({
      where: { status: TenantStatus.ACTIVE },
      select: { id: true },
    })
    expect(mockControlPlanePrisma.tenantUsageSnapshot.upsert).toHaveBeenCalledWith({
      where: { tenantId_month: { tenantId: 't-1', month: '2026-08' } },
      create: { tenantId: 't-1', month: '2026-08', employeesOnRecord: 39 },
      update: { employeesOnRecord: 39, capturedAt: expect.any(Date) },
    })
    expect(mockControlPlanePrisma.tenantUsageSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_month: { tenantId: 't-2', month: '2026-08' } },
        create: { tenantId: 't-2', month: '2026-08', employeesOnRecord: 4 },
      }),
    )
  })

  it('counts in the tenant database, never the control-plane one', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([{ id: 't-1' }])
    const client = clientCounting(7)
    mockTenantManager.withClient.mockImplementation(async (_id: string, cb: (c: typeof client) => unknown) => cb(client))

    await scheduler.captureAll(new Date('2026-08-08T03:00:00Z'))

    // The borrow-scoped variant, with the tenant id — the same path TenantContextInterceptor uses.
    expect(mockTenantManager.withClient).toHaveBeenCalledWith('t-1', expect.any(Function))
    expect(client.employee.count).toHaveBeenCalledTimes(1)
  })

  it('keeps going when one tenant database is unreachable', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([{ id: 'broken' }, { id: 'ok' }])
    mockTenantManager.withClient.mockImplementation(
      async (tenantId: string, cb: (c: ReturnType<typeof clientCounting>) => unknown) => {
        if (tenantId === 'broken') throw new Error('ECONNREFUSED')
        return cb(clientCounting(12))
      },
    )

    const captured = await scheduler.captureAll(new Date('2026-08-08T03:00:00Z'))

    // One tenant's outage must not cost every other tenant their number for the month.
    expect(captured).toBe(1)
    expect(mockControlPlanePrisma.tenantUsageSnapshot.upsert).toHaveBeenCalledTimes(1)
    expect(mockControlPlanePrisma.tenantUsageSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ tenantId: 'ok', employeesOnRecord: 12 }) }),
    )
  })

  it('records a tenant with zero employees rather than skipping it', async () => {
    // A provisioned-but-empty tenant is a real state (post-signup, pre-import) and 0 is the answer,
    // not the absence of one. Skipping it would make a month look like the tenant did not exist.
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([{ id: 'fresh' }])
    mockTenantManager.withClient.mockImplementation(
      async (_id: string, cb: (c: ReturnType<typeof clientCounting>) => unknown) => cb(clientCounting(0)),
    )

    await scheduler.captureAll(new Date('2026-08-08T03:00:00Z'))

    expect(mockControlPlanePrisma.tenantUsageSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ employeesOnRecord: 0 }) }),
    )
  })

  it('does nothing and does not throw when there are no active tenants', async () => {
    mockControlPlanePrisma.tenant.findMany.mockResolvedValue([])

    await expect(scheduler.captureAll(new Date('2026-08-08T03:00:00Z'))).resolves.toBe(0)
    expect(mockControlPlanePrisma.tenantUsageSnapshot.upsert).not.toHaveBeenCalled()
  })
})

describe('monthKey', () => {
  it('formats as YYYY-MM with a zero-padded month', () => {
    expect(monthKey(new Date('2026-08-08T03:00:00Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12')
  })

  it('uses UTC so the month boundary does not move with DST', () => {
    // 2026-09-01T00:30 in Europe/Warsaw (UTC+2 in summer) is still 2026-08-31T22:30 UTC. The capture
    // runs at 03:00 local; anchoring to UTC keeps a month's boundary in one place all year.
    expect(monthKey(new Date('2026-08-31T22:30:00Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-09-01T00:30:00Z'))).toBe('2026-09')
  })
})
