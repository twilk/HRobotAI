import { Test, TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { SnapshotService, ALGORITHM_VERSION } from './snapshot.service.js'
import { PerformanceConfigService } from './performance-config.service.js'

/** Mock tenant client exposing exactly the delegates SnapshotService touches (mirrors the
 * `makeClient` idiom in `capacity-gap.service.spec` / `performance-config.service.spec`). */
function makeClient() {
  return {
    employee: { findUnique: jest.fn() },
    workOrder: { findMany: jest.fn() },
    complaint: { findMany: jest.fn() },
    leaveRequest: { findMany: jest.fn() },
    employeePerformanceSnapshot: { upsert: jest.fn() },
    // NOTE: no `create` — if the service ever reaches for create() on the snapshot delegate the
    // test throws, which is exactly how we prove idempotency goes through upsert (B2), not create.
    performanceConfig: { findFirst: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const EMP = 'emp-1'
const WINDOW = { start: new Date('2026-06-01T00:00:00.000Z'), end: new Date('2026-06-15T00:00:00.000Z') }

/** An employee hired long before the window (⇒ not a new hire, no onboarding exclusion). */
const veteranEmployee = {
  id: EMP,
  hiredAt: new Date('2024-01-01T00:00:00.000Z'),
  position: 'DETAILER',
  unitId: 'unit-1',
  etat: 1,
}

/** 4 DONE work orders, all within SLA (completedAt <= dueAt), cycle times 30/60/90/120 min.
 * Also one CANCELLED and one OPEN order in the same window — they must NOT count (M6/M7). */
function happyPathOrders() {
  const at = (h: number, m: number) => new Date(`2026-06-02T0${h}:${m === 0 ? '00' : m}:00.000Z`)
  const assignedAt = at(8, 0)
  const dueAt = new Date(assignedAt.getTime() + 180 * 60_000) // 11:00 — all four finish before this
  const done = (completedAt: Date) => ({ status: 'DONE', assignedAt, dueAt, completedAt })
  return [
    done(at(8, 30)), // 30 min
    done(at(9, 0)), //  60 min
    done(at(9, 30)), // 90 min
    done(new Date(assignedAt.getTime() + 120 * 60_000)), // 120 min
    { status: 'CANCELLED', assignedAt, dueAt, completedAt: null },
    { status: 'OPEN', assignedAt, dueAt, completedAt: null },
  ]
}

/** Extract the object the service upserted (the `create` branch payload carries every field). */
function upsertedData(client: MockClient) {
  const call = client.employeePerformanceSnapshot.upsert.mock.calls[0]![0] as {
    where: unknown
    create: Record<string, unknown>
    update: Record<string, unknown>
  }
  return call
}

describe('SnapshotService', () => {
  let service: SnapshotService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SnapshotService, PerformanceConfigService],
    }).compile()
    service = module.get(SnapshotService)
    client = makeClient()
    jest.clearAllMocks()
    // Default: no config row for the unit or tenant → PerformanceConfigService.defaultConfig
    // (weights 0.30/0.25/0.25/0.20, confidenceMinDays 30) drives scoring deterministically.
    client.performanceConfig.findFirst.mockResolvedValue(null)
    client.employee.findUnique.mockResolvedValue(veteranEmployee)
    client.leaveRequest.findMany.mockResolvedValue([])
    client.employeePerformanceSnapshot.upsert.mockResolvedValue({ id: 'snap-1' })
  })

  describe('happy path (all operational metrics present)', () => {
    beforeEach(() => {
      client.workOrder.findMany.mockResolvedValue(happyPathOrders())
      client.complaint.findMany.mockResolvedValue([{ id: 'c-1' }]) // 1 complaint / 4 done = 0.25
    })

    it('computes the four raw metrics from DONE work orders only (CANCELLED/OPEN ignored — M6/M7)', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      const { create } = upsertedData(client)

      expect(create.throughput).toBe(4) // DONE count, not 6
      expect(create.medianCycleMinutes).toBe(75) // median(30,60,90,120)
      expect(create.slaHitRate).toBe(1) // all 4 completedAt <= dueAt
      expect(create.defectRate).toBeCloseTo(0.25) // 1 complaint / 4 done
    })

    it('derives compositeScore by renormalizing weights over the present dimensions', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      const { create } = upsertedData(client)
      // timeliness = slaHitRate*100 = 100 (w 0.25); quality = (1-defectRate)*100 = 75 (w 0.25).
      // performance + development are deferred (peer-normalization / multi-window → Task 7), so the
      // composite renormalizes over {timeliness, quality}: (100*.25 + 75*.25) / .5 = 87.5.
      expect(create.compositeScore).toBeCloseTo(87.5)
      expect(create.developmentSlope).toBeNull() // NOT computed here — needs the series (Task 7)
    })

    it('stores versioning + a stable peerGroupKey and flags a veteran as not-new-hire', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      const { create } = upsertedData(client)

      expect(create.algorithmVersion).toBe(ALGORITHM_VERSION)
      expect(create.algorithmVersion).toBe(1)
      expect(typeof create.configHash).toBe('string')
      expect(create.configHash).toMatch(/^[0-9a-f]{16}$/)
      expect(create.peerGroupKey).toBe('DETAILER|unit-1|1') // role|unit|etat
      expect(create.isNewHire).toBe(false)
      expect(create.excludedReason).toBeNull()
      expect(Number(create.confidence)).toBeGreaterThan(0) // 4 samples, long tenure
    })

    it('loads work orders scoped to the employee+window and excludes CANCELLED at the query', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      expect(client.workOrder.findMany).toHaveBeenCalledWith({
        where: {
          assignedToEmployeeId: EMP,
          assignedAt: { gte: WINDOW.start, lt: WINDOW.end },
          status: { not: 'CANCELLED' },
        },
      })
    })

    it('upserts by the [employeeId, windowStart, windowEnd] compound key (B2 idempotency)', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      const { where } = upsertedData(client)
      expect(where).toEqual({
        employeeId_windowStart_windowEnd: {
          employeeId: EMP,
          windowStart: WINDOW.start,
          windowEnd: WINDOW.end,
        },
      })
    })

    it('is idempotent: computing the same window twice upserts (never creates) a second time', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      // Two upserts, the same compound key both times → no duplicate row. The mock has no
      // `create`, so a create() attempt would have thrown before we got here.
      expect(client.employeePerformanceSnapshot.upsert).toHaveBeenCalledTimes(2)
      const firstWhere = (client.employeePerformanceSnapshot.upsert.mock.calls[0]![0] as { where: unknown }).where
      const secondWhere = (client.employeePerformanceSnapshot.upsert.mock.calls[1]![0] as { where: unknown }).where
      expect(secondWhere).toEqual(firstWhere)
    })
  })

  describe('no-work window', () => {
    beforeEach(() => {
      client.workOrder.findMany.mockResolvedValue([])
      client.complaint.findMany.mockResolvedValue([])
    })

    it('yields null metrics + low confidence, not a zero-punished throughput score', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      const { create } = upsertedData(client)

      expect(create.throughput).toBe(0)
      expect(create.medianCycleMinutes).toBeNull()
      expect(create.slaHitRate).toBeNull()
      expect(create.defectRate).toBeNull() // denominator < 1 → missing data, not 0 (M7)
      expect(create.compositeScore).toBeNull() // < 2 present dimensions (M8)
      expect(Number(create.confidence)).toBe(0) // no samples → low confidence, not poor score
      expect(create.excludedReason).toBeNull()
    })
  })

  describe('structural exclusions (M12 — derived from data, not string-guessed)', () => {
    beforeEach(() => {
      client.workOrder.findMany.mockResolvedValue(happyPathOrders())
      client.complaint.findMany.mockResolvedValue([{ id: 'c-1' }])
    })

    it("maps an overlapping L4 leave to excludedReason='L4' (metrics still computed)", async () => {
      client.leaveRequest.findMany.mockResolvedValue([
        {
          type: 'L4',
          status: 'APPROVED',
          startDate: new Date('2026-06-05T00:00:00.000Z'),
          endDate: new Date('2026-06-10T00:00:00.000Z'),
        },
      ])
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      const { create } = upsertedData(client)
      expect(create.excludedReason).toBe('L4')
      // Exclusion is a trend-flag, NOT a metric-nuller — the window's numbers are still cached so a
      // return-from-L4 window can be *skipped* by the trajectory (Task 7), never averaged in low.
      expect(create.throughput).toBe(4)
      expect(create.compositeScore).toBeCloseTo(87.5)
    })

    it("maps a free-form 'URLOP_WYPOCZYNKOWY' leave to excludedReason='URLOP'", async () => {
      client.leaveRequest.findMany.mockResolvedValue([
        {
          type: 'URLOP_WYPOCZYNKOWY',
          status: 'APPROVED',
          startDate: new Date('2026-06-03T00:00:00.000Z'),
          endDate: new Date('2026-06-04T00:00:00.000Z'),
        },
      ])
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      expect(upsertedData(client).create.excludedReason).toBe('URLOP')
    })

    it('queries only overlapping APPROVED leaves for this employee', async () => {
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      expect(client.leaveRequest.findMany).toHaveBeenCalledWith({
        where: {
          employeeId: EMP,
          status: 'APPROVED',
          startDate: { lte: WINDOW.end },
          endDate: { gte: WINDOW.start },
        },
      })
    })

    it("flags a window inside the onboarding period as excludedReason='ONBOARDING' + isNewHire", async () => {
      client.employee.findUnique.mockResolvedValue({
        ...veteranEmployee,
        hiredAt: new Date('2026-06-01T00:00:00.000Z'), // hired at window start
      })
      client.leaveRequest.findMany.mockResolvedValue([])
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      const { create } = upsertedData(client)
      expect(create.excludedReason).toBe('ONBOARDING')
      expect(create.isNewHire).toBe(true)
    })

    it('gives an overlapping leave precedence over onboarding when both apply', async () => {
      client.employee.findUnique.mockResolvedValue({
        ...veteranEmployee,
        hiredAt: new Date('2026-06-01T00:00:00.000Z'),
      })
      client.leaveRequest.findMany.mockResolvedValue([
        {
          type: 'zwolnienie chorobowe',
          status: 'APPROVED',
          startDate: new Date('2026-06-05T00:00:00.000Z'),
          endDate: new Date('2026-06-08T00:00:00.000Z'),
        },
      ])
      await service.computeSnapshot(asClient(client), EMP, WINDOW)
      expect(upsertedData(client).create.excludedReason).toBe('L4') // "chorob" → L4, wins over onboarding
    })
  })
})

// --- READ paths (Task 9): overview heatmap + employee cards + self-lookup -----------------------
function makeReadClient() {
  return {
    employee: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    employeePerformanceSnapshot: { findMany: jest.fn() },
    performanceConfig: { findFirst: jest.fn().mockResolvedValue(null) }, // → schema defaults
  }
}
type ReadClient = ReturnType<typeof makeReadClient>
const asReadClient = (c: ReadClient): TenantClient => c as unknown as TenantClient

function readSnap(over: { employeeId: string; windowEnd: string } & Partial<Record<string, unknown>>) {
  const { windowEnd, ...rest } = over
  return {
    windowStart: new Date('2026-06-01T00:00:00.000Z'),
    windowEnd: new Date(windowEnd),
    throughput: 5,
    slaHitRate: 0.9,
    defectRate: 0.05,
    compositeScore: 80,
    developmentSlope: 1,
    confidence: 0.9,
    isNewHire: false,
    excludedReason: null,
    ...rest,
  }
}

describe('SnapshotService (read paths)', () => {
  let service: SnapshotService
  let client: ReadClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SnapshotService, PerformanceConfigService],
    }).compile()
    service = module.get(SnapshotService)
    client = makeReadClient()
    jest.clearAllMocks()
    client.performanceConfig.findFirst.mockResolvedValue(null)
  })

  describe('overview', () => {
    it('HR (scope null) reads every employee unfiltered, latest snapshot per employee', async () => {
      client.employee.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        readSnap({ employeeId: 'e1', windowEnd: '2026-06-15T00:00:00.000Z', compositeScore: 90 }),
        readSnap({ employeeId: 'e1', windowEnd: '2026-06-01T00:00:00.000Z', compositeScore: 70 }),
        readSnap({ employeeId: 'e2', windowEnd: '2026-06-15T00:00:00.000Z', compositeScore: 60 }),
      ])

      const rows = (await service.overview(asReadClient(client), null)) as Array<Record<string, unknown>>

      // scope null ⇒ empty where (no unit filter)
      expect(client.employee.findMany).toHaveBeenCalledWith({ where: {}, select: { id: true } })
      expect(rows).toHaveLength(2)
      const e1 = rows.find((r) => r.employeeId === 'e1')!
      expect(e1.compositeScore).toBe(90) // newest window wins
    })

    it('MANAGER (scope=[u1]) filters employees to the managed unit(s)', async () => {
      client.employee.findMany.mockResolvedValue([{ id: 'e1' }])
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        readSnap({ employeeId: 'e1', windowEnd: '2026-06-15T00:00:00.000Z' }),
      ])

      await service.overview(asReadClient(client), ['u1'])

      expect(client.employee.findMany).toHaveBeenCalledWith({ where: { unitId: { in: ['u1'] } }, select: { id: true } })
    })

    it('an empty scope array returns zero rows and never queries snapshots (in:[] ≠ bypass)', async () => {
      client.employee.findMany.mockResolvedValue([])
      const rows = await service.overview(asReadClient(client), [])
      expect(rows).toEqual([])
      expect(client.employeePerformanceSnapshot.findMany).not.toHaveBeenCalled()
    })
  })

  describe('employeeCard', () => {
    it('returns the series (asc) + derived retentionSignal for an in-scope employee', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u1' })
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        readSnap({ employeeId: 'e1', windowEnd: '2026-06-15T00:00:00.000Z', compositeScore: 85, developmentSlope: 1 }),
      ])

      const card = (await service.employeeCard(asReadClient(client), 'e1', ['u1'])) as Record<string, unknown>

      expect(card.employeeId).toBe('e1')
      expect((card.series as unknown[]).length).toBe(1)
      expect(card.retentionSignal).toBe('UTRZYMAC') // high score, non-negative slope
      expect((card.factors as Record<string, unknown>).compositeScore).toBe(85)
    })

    it('404s for an unknown id BEFORE any scope check', async () => {
      client.employee.findUnique.mockResolvedValue(null)
      await expect(service.employeeCard(asReadClient(client), 'nope', ['u1'])).rejects.toThrow(/not found/i)
    })

    it('403s for an existing employee OUTSIDE the manager scope', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u2' })
      await expect(service.employeeCard(asReadClient(client), 'e1', ['u1'])).rejects.toThrow(/scope/i)
    })

    it('a GLOBAL actor (scope null) is never scope-checked', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u2' })
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([])
      const card = (await service.employeeCard(asReadClient(client), 'e1', null)) as Record<string, unknown>
      expect(card.employeeId).toBe('e1')
      expect(card.retentionSignal).toBeNull() // no snapshots ⇒ null signal
    })
  })

  describe('employeeCardByKeycloakSub', () => {
    it('resolves the caller via keycloakSub and returns their own card (no scope)', async () => {
      client.employee.findFirst.mockResolvedValue({ id: 'self' })
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        readSnap({ employeeId: 'self', windowEnd: '2026-06-15T00:00:00.000Z' }),
      ])

      const card = (await service.employeeCardByKeycloakSub(asReadClient(client), 'kc-self')) as Record<string, unknown>

      expect(client.employee.findFirst).toHaveBeenCalledWith({ where: { user: { keycloakSub: 'kc-self' } }, select: { id: true } })
      expect(card.employeeId).toBe('self')
    })

    it('404s when the login has no linked Employee', async () => {
      client.employee.findFirst.mockResolvedValue(null)
      await expect(service.employeeCardByKeycloakSub(asReadClient(client), 'kc-x')).rejects.toThrow(/no employee/i)
    })
  })
})
