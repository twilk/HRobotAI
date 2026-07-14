import { Test, TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { RecommendationService, RETENTION_CONFIDENCE_MIN } from './recommendation.service.js'
import { PerformanceConfigService } from './performance-config.service.js'
import { CapacityGapService } from './capacity-gap.service.js'

/** Mock tenant client exposing exactly the delegates RecommendationService touches (mirrors the
 * `makeClient` idiom in the sibling specs). No `update`/`delete` on recruitmentRecommendation — if
 * the service ever mutated a prior recommendation row the test would throw, which is how we prove
 * the B3 immutable-event invariant (never mutate an old row, never a `supersededAt`). */
function makeClient() {
  return {
    employeePerformanceSnapshot: { findMany: jest.fn(), upsert: jest.fn() },
    recruitmentRecommendation: { findFirst: jest.fn(), create: jest.fn() },
    shiftDemand: { findMany: jest.fn() },
    performanceConfig: { findFirst: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const W0 = { start: new Date('2026-05-04T00:00:00.000Z'), end: new Date('2026-05-18T00:00:00.000Z') }
const W1 = { start: new Date('2026-05-18T00:00:00.000Z'), end: new Date('2026-06-01T00:00:00.000Z') }
const W2 = { start: new Date('2026-06-01T00:00:00.000Z'), end: new Date('2026-06-15T00:00:00.000Z') }
const CURRENT = { start: new Date('2026-06-15T00:00:00.000Z'), end: new Date('2026-06-29T00:00:00.000Z') }

/** Build a snapshot row as the service reads it (numbers stand in for Prisma Decimals; the service
 * coerces via Number()). */
function snap(over: Partial<Record<string, unknown>> & { employeeId: string; window: { start: Date; end: Date } }) {
  const { window, ...rest } = over
  return {
    id: `snap-${rest.employeeId}-${window.end.toISOString()}`,
    windowStart: window.start,
    windowEnd: window.end,
    throughput: 0,
    medianCycleMinutes: null,
    slaHitRate: null,
    defectRate: null,
    compositeScore: null,
    developmentSlope: null,
    confidence: 0.9,
    peerGroupKey: `DETAILER|unit-1|1`,
    isNewHire: false,
    excludedReason: null,
    ...rest,
  }
}

function upsertFor(client: MockClient, employeeId: string) {
  const call = client.employeePerformanceSnapshot.upsert.mock.calls.find(
    (c) => (c[0] as { create: { employeeId: string } }).create.employeeId === employeeId,
  )
  if (!call) throw new Error(`no upsert for ${employeeId}`)
  return call[0] as { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }
}

const SCOPE = { scopeType: 'LOKALIZACJA' as const, scopeId: 'lok-1' }
const WEEK_START = new Date('2026-06-15T00:00:00.000Z')

describe('RecommendationService', () => {
  let service: RecommendationService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecommendationService, PerformanceConfigService, CapacityGapService],
    }).compile()
    service = module.get(RecommendationService)
    client = makeClient()
    jest.clearAllMocks()
    // No config row → PerformanceConfigService defaults drive everything deterministically:
    // weights .30/.25/.25/.20, minValidWindows 3, minSlopeForGrowth 0.5, minPeerGroupSize 5,
    // defectThreshold 0.10.
    client.performanceConfig.findFirst.mockResolvedValue(null)
    client.employeePerformanceSnapshot.upsert.mockResolvedValue({ id: 'up' })
    client.recruitmentRecommendation.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'rec-new', ...args.data }),
    )
  })

  // ---------------------------------------------------------------------------------------------
  describe('finalizeWindow', () => {
    it('peer-normalizes throughput into the performance dim and recomputes the composite (meaningful group ≥ min)', async () => {
      // 5 employees, same peer group, throughputs 1..5; each 100% on time, 0 defects.
      const rows = [1, 2, 3, 4, 5].map((tp) =>
        snap({
          employeeId: `emp-${tp}`,
          window: CURRENT,
          throughput: tp,
          slaHitRate: 1, // timeliness dim = 100
          defectRate: 0, // quality dim   = 100
          confidence: 0.9,
        }),
      )
      client.employeePerformanceSnapshot.findMany.mockResolvedValue(rows)

      await service.finalizeWindow(asClient(client), CURRENT)

      expect(client.employeePerformanceSnapshot.upsert).toHaveBeenCalledTimes(5)

      // emp-5 is the top throughput → mid-rank percentile 90 → composite over {perf 90, timeliness
      // 100, quality 100} renormalized over weight .8 = (90*.3 + 100*.25 + 100*.25)/.8 = 96.25.
      const top = upsertFor(client, 'emp-5').update
      expect(Number(top.compositeScore)).toBeCloseTo(96.25)
      expect(top.developmentSlope).toBeNull() // only one window → no trend yet

      // emp-1 bottom throughput → percentile 10 → (10*.3 + 100*.25 + 100*.25)/.8 = 66.25.
      const bottom = upsertFor(client, 'emp-1').update
      expect(Number(bottom.compositeScore)).toBeCloseTo(66.25)

      // group size 5 ≥ minPeerGroupSize and finest level used → confidence NOT penalized.
      expect(Number(top.confidence)).toBeCloseTo(0.9)
    })

    it('penalizes confidence when the peer group is below min (M10 not-meaningful normalization)', async () => {
      // singleton peer group → normalization not meaningful.
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        snap({ employeeId: 'solo', window: CURRENT, throughput: 3, slaHitRate: 1, defectRate: 0, confidence: 0.9 }),
      ])
      await service.finalizeWindow(asClient(client), CURRENT)
      const upd = upsertFor(client, 'solo').update
      expect(Number(upd.confidence)).toBeLessThan(0.9) // penalized
    })

    it('computes a positive developmentSlope from ≥ minValidWindows rising composites', async () => {
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        snap({ employeeId: 'rise', window: W0, compositeScore: 40 }),
        snap({ employeeId: 'rise', window: W1, compositeScore: 50 }),
        snap({ employeeId: 'rise', window: W2, compositeScore: 60 }),
        snap({ employeeId: 'rise', window: CURRENT, throughput: 3, slaHitRate: 1, defectRate: 0 }),
      ])
      await service.finalizeWindow(asClient(client), CURRENT)
      const upd = upsertFor(client, 'rise').update
      expect(Number(upd.developmentSlope)).toBeGreaterThan(0)
    })

    it('SKIPS excluded windows when building the slope series → below min valid points ⇒ null slope (M9)', async () => {
      // Only ONE genuinely valid prior window; the middle window is an L4 exclusion. Non-excluded
      // valid points = [W0, current] = 2 < minValidWindows(3) ⇒ slope null. Had the excluded window
      // been counted, there would be 3 points and a non-null slope — so a null here proves the skip.
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        snap({ employeeId: 'l4', window: W0, compositeScore: 40 }),
        snap({ employeeId: 'l4', window: W1, compositeScore: 999, excludedReason: 'L4' }),
        snap({ employeeId: 'l4', window: CURRENT, throughput: 3, slaHitRate: 1, defectRate: 0 }),
      ])
      await service.finalizeWindow(asClient(client), CURRENT)
      const upd = upsertFor(client, 'l4').update
      expect(upd.developmentSlope).toBeNull()
    })

    it('upserts by the compound key (B2 cache overwrite), never create', async () => {
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        snap({ employeeId: 'emp-1', window: CURRENT, throughput: 2, slaHitRate: 1, defectRate: 0 }),
      ])
      await service.finalizeWindow(asClient(client), CURRENT)
      const { where } = upsertFor(client, 'emp-1')
      expect(where).toEqual({
        employeeId_windowStart_windowEnd: { employeeId: 'emp-1', windowStart: CURRENT.start, windowEnd: CURRENT.end },
      })
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('emitRetention', () => {
    beforeEach(() => {
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        // weak-but-rising → INWESTOWAC
        snap({ employeeId: 'invest', window: CURRENT, compositeScore: 35, developmentSlope: 5, confidence: 0.9, throughput: 4, slaHitRate: 0.5, defectRate: 0.4 }),
        // good-but-declining → RYZYKO
        snap({ employeeId: 'risk', window: CURRENT, compositeScore: 85, developmentSlope: -5, confidence: 0.9, throughput: 9, slaHitRate: 0.95, defectRate: 0.02 }),
        // null trend → OBSERWOWAC (never RYZYKO), M9
        snap({ employeeId: 'watch', window: CURRENT, compositeScore: 50, developmentSlope: null, confidence: 0.9, throughput: 6 }),
      ])
    })

    it('derives the per-employee retention signal from the finalized snapshot', async () => {
      const out = await service.emitRetention(asClient(client), CURRENT)
      const byEmp = Object.fromEntries(out.map((r) => [r.employeeId, r.signal]))
      expect(byEmp.invest).toBe('INWESTOWAC')
      expect(byEmp.risk).toBe('RYZYKO')
      expect(byEmp.watch).toBe('OBSERWOWAC')
    })

    it('carries an explainable factors breakdown (dims + slope + confidence)', async () => {
      const out = await service.emitRetention(asClient(client), CURRENT)
      const invest = out.find((r) => r.employeeId === 'invest')!
      expect(invest.factors).toMatchObject({
        compositeScore: 35,
        developmentSlope: 5,
        confidence: 0.9,
        slaHitRate: 0.5,
        defectRate: 0.4,
        throughput: 4,
      })
    })

    it('reads only the finalized snapshots of the given window', async () => {
      await service.emitRetention(asClient(client), CURRENT)
      expect(client.employeePerformanceSnapshot.findMany).toHaveBeenCalledWith({
        where: { windowStart: CURRENT.start, windowEnd: CURRENT.end },
      })
    })

    it('RETENTION_CONFIDENCE_MIN gates low-confidence employees to OBSERWOWAC', async () => {
      client.employeePerformanceSnapshot.findMany.mockResolvedValue([
        snap({ employeeId: 'lowconf', window: CURRENT, compositeScore: 35, developmentSlope: 5, confidence: RETENTION_CONFIDENCE_MIN - 0.01 }),
      ])
      const out = await service.emitRetention(asClient(client), CURRENT)
      expect(out[0]!.signal).toBe('OBSERWOWAC')
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('currentRecommendation', () => {
    it('returns the newest event per scope (max computedAt), the head of the replaces-chain', async () => {
      const head = { id: 'rec-2', scopeType: 'LOKALIZACJA', scopeId: 'lok-1', verdict: 'WZNOW' }
      client.recruitmentRecommendation.findFirst.mockResolvedValue(head)
      const got = await service.currentRecommendation(asClient(client), SCOPE)
      expect(got).toBe(head)
      expect(client.recruitmentRecommendation.findFirst).toHaveBeenCalledWith({
        where: { scopeType: 'LOKALIZACJA', scopeId: 'lok-1' },
        orderBy: { computedAt: 'desc' },
      })
    })
  })

  // ---------------------------------------------------------------------------------------------
  describe('emitRecruitment', () => {
    /** A location with a capacity gap of 2 (KASJER short by 2). */
    function gapDemands() {
      return [{ id: 'd1', requiredRole: 'KASJER', requiredCount: 2, shifts: [] }]
    }
    /** A fully-covered location (gap 0). */
    function coveredDemands() {
      return [{ id: 'd1', requiredRole: 'KASJER', requiredCount: 1, shifts: [{ id: 's1' }] }]
    }
    const healthySnaps = [
      snap({ employeeId: 'a', window: CURRENT, slaHitRate: 1, defectRate: 0 }),
      snap({ employeeId: 'b', window: CURRENT, slaHitRate: 0.95, defectRate: 0.01 }),
    ]

    it('emits WZNOW when there is a capacity gap', async () => {
      client.shiftDemand.findMany.mockResolvedValue(gapDemands())
      client.employeePerformanceSnapshot.findMany.mockResolvedValue(healthySnaps)
      client.recruitmentRecommendation.findFirst.mockResolvedValue(null)

      const rec = await service.emitRecruitment(asClient(client), SCOPE, WEEK_START)

      expect(rec.verdict).toBe('WZNOW')
      const created = client.recruitmentRecommendation.create.mock.calls[0]![0] as { data: Record<string, unknown> }
      expect(created.data.scopeType).toBe('LOKALIZACJA')
      expect(created.data.scopeId).toBe('lok-1')
      expect(created.data.replacesRecommendationId).toBeNull() // first event in the chain
      // factors frozen at emit time (B2) — carry the numeric breakdown.
      expect((created.data.factors as { totalGap: number }).totalGap).toBe(2)
      // B3: NO supersededAt anywhere in the payload.
      expect('supersededAt' in created.data).toBe(false)
    })

    it('emits WSTRZYMAJ when fully covered (no gap) and operationally healthy', async () => {
      client.shiftDemand.findMany.mockResolvedValue(coveredDemands())
      client.employeePerformanceSnapshot.findMany.mockResolvedValue(healthySnaps)
      client.recruitmentRecommendation.findFirst.mockResolvedValue(null)

      const rec = await service.emitRecruitment(asClient(client), SCOPE, WEEK_START)
      expect(rec.verdict).toBe('WSTRZYMAJ')
    })

    it('writes a NEW immutable event pointing back via replacesRecommendationId, never mutating the old row (B3)', async () => {
      client.shiftDemand.findMany.mockResolvedValue(gapDemands()) // → WZNOW
      client.employeePerformanceSnapshot.findMany.mockResolvedValue(healthySnaps)
      // A stale WSTRZYMAJ event is currently the head.
      client.recruitmentRecommendation.findFirst.mockResolvedValue({
        id: 'rec-old',
        verdict: 'WSTRZYMAJ',
        factors: { totalGap: -1, qualityBelowTarget: false, timelinessBelowTarget: false },
      })

      const rec = await service.emitRecruitment(asClient(client), SCOPE, WEEK_START)

      expect(rec.verdict).toBe('WZNOW')
      const created = client.recruitmentRecommendation.create.mock.calls[0]![0] as { data: Record<string, unknown> }
      expect(created.data.replacesRecommendationId).toBe('rec-old')
      // no update/delete delegate exists on the mock — reaching for one would have thrown.
    })

    it('does NOT create a new event when verdict + material factors are unchanged (B4 dedup)', async () => {
      client.shiftDemand.findMany.mockResolvedValue(gapDemands())
      client.employeePerformanceSnapshot.findMany.mockResolvedValue(healthySnaps)

      // First run: no head → creates rec-new (captured via the create mock impl).
      client.recruitmentRecommendation.findFirst.mockResolvedValueOnce(null)
      const first = await service.emitRecruitment(asClient(client), SCOPE, WEEK_START)
      expect(client.recruitmentRecommendation.create).toHaveBeenCalledTimes(1)

      // Second run with identical inputs: head is now `first` → verdict + material factors match → dedup.
      client.recruitmentRecommendation.findFirst.mockResolvedValueOnce(first)
      const second = await service.emitRecruitment(asClient(client), SCOPE, WEEK_START)

      expect(client.recruitmentRecommendation.create).toHaveBeenCalledTimes(1) // STILL one — no new row
      expect(second.id).toBe(first.id) // returns the existing head
    })
  })
})
