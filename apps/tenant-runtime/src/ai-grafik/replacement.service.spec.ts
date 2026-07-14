import type { TenantClient } from '@hrobot/db'
import { TenantPrisma } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { ReplacementService, type RankableShift, type VacatedShift } from './replacement.service.js'
import type { SwapFeasibilityValidator } from '../shift-swap/swap-feasibility-validator.js'
import type { AiConfigActor } from './ai-config.service.js'
import type { CostService } from '../cost/cost.service.js'

const { Decimal } = TenantPrisma

const UNIT = 'unit-1'
const VACATED_EMP = 'emp-vacated'
const SHIFT_ID = 'shift-1'
const LOK_ID = 'lok-1'

type PoolRow = {
  id: string
  preferredShiftStart: string[]
  unitId?: string
  homeLat?: number | null
  homeLng?: number | null
  userId?: string | null
}
type WeekShiftRow = { employeeId: string; start: string; end: string }
type LokalizacjaRow = { lat: number | null; lng: number | null } | null
type CostEmployeeRow = { id: string; position: string; employmentType: string }

type MockClient = {
  employee: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock }
  shift: { findMany: jest.Mock }
  lokalizacja: { findUnique: jest.Mock }
}

/**
 * `localPool` answers a same-unit query (`where.unitId` a plain string); `crossPool` a cross-unit
 * query (`where.unitId` an object, i.e. `{ not: ... }`); `costEmployees` answers
 * `computeWorkCostDeltas`'s id-only lookup (`where.unitId` absent entirely). Pre-travel tests only
 * ever exercise the local branch and never set `crossPool`/`costEmployees`/`lokalizacja`.
 */
function makeClient(
  localPool: PoolRow[],
  weekShifts: WeekShiftRow[] = [],
  opts: { crossPool?: PoolRow[]; costEmployees?: CostEmployeeRow[]; lokalizacja?: LokalizacjaRow } = {},
): MockClient {
  return {
    employee: {
      findMany: jest.fn().mockImplementation((args: { where?: { unitId?: unknown } }) => {
        const unitId = args?.where?.unitId
        if (unitId === undefined) return Promise.resolve(opts.costEmployees ?? [])
        return Promise.resolve(typeof unitId === 'object' && unitId !== null ? (opts.crossPool ?? []) : localPool)
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ unitId: UNIT }),
    },
    shift: { findMany: jest.fn().mockResolvedValue(weekShifts) },
    lokalizacja: { findUnique: jest.fn().mockResolvedValue(opts.lokalizacja ?? null) },
  }
}

const as = (c: MockClient) => c as unknown as TenantClient

/** A give-away vacated shift on Wednesday 2026-07-15 (ISO week Mon 07-13 .. Sun 07-19). */
function makeShift(overrides: Partial<RankableShift> = {}): RankableShift {
  return {
    id: SHIFT_ID,
    employeeId: VACATED_EMP,
    role: 'KASJER',
    start: '08:00',
    end: '16:00',
    date: new Date('2026-07-15T00:00:00.000Z'),
    lokalizacjaId: LOK_ID,
    employee: { unitId: UNIT },
    ...overrides,
  }
}

/** Validator that feasibility-passes everyone (default happy path). */
const allowAll: SwapFeasibilityValidator = { validate: async () => ({ feasible: true }) }

/** CostService stub with no rates configured — every `workCostDelta` resolves to `null`, so ranking
 *  is driven purely by the pre-existing tie-breaks / travel cost. Matches the real `CostService`'s
 *  "never a phantom 0" contract. */
const noCost: CostService = {
  findRatesForPairs: jest.fn().mockResolvedValue([]),
  shiftCost: jest.fn(),
} as unknown as CostService

describe('ReplacementService.rankCandidatesForShift', () => {
  describe('pool construction + vetting', () => {
    it('queries same-unit, role-qualified employees excluding the vacated one', async () => {
      const client = makeClient([{ id: 'a', preferredShiftStart: [] }])
      const service = new ReplacementService(allowAll, noCost)

      await service.rankCandidatesForShift(as(client), makeShift())

      expect(client.employee.findMany).toHaveBeenCalledWith({
        where: {
          unitId: UNIT,
          qualifications: { has: 'KASJER' },
          id: { not: VACATED_EMP },
        },
        select: { id: true, preferredShiftStart: true, unitId: true, homeLat: true, homeLng: true, userId: true },
      })
    })

    it('calls the validator once per pooled candidate with the give-away shape', async () => {
      const validate = jest.fn().mockResolvedValue({ feasible: true })
      const client = makeClient([
        { id: 'a', preferredShiftStart: [] },
        { id: 'b', preferredShiftStart: [] },
      ])
      const service = new ReplacementService({ validate }, noCost)

      await service.rankCandidatesForShift(as(client), makeShift())

      expect(validate).toHaveBeenCalledTimes(2)
      expect(validate).toHaveBeenCalledWith({
        client: as(client),
        requesterShift: { id: SHIFT_ID, employeeId: VACATED_EMP },
        targetShift: null,
        incomingRequesterShiftEmployeeId: 'a',
        incomingTargetShiftEmployeeId: null,
      })
      expect(validate).toHaveBeenCalledWith({
        client: as(client),
        requesterShift: { id: SHIFT_ID, employeeId: VACATED_EMP },
        targetShift: null,
        incomingRequesterShiftEmployeeId: 'b',
        incomingTargetShiftEmployeeId: null,
      })
    })

    it('resolves the unit via a lookup when the shift has no pre-loaded employee', async () => {
      const client = makeClient([{ id: 'a', preferredShiftStart: [] }])
      const service = new ReplacementService(allowAll, noCost)

      await service.rankCandidatesForShift(as(client), makeShift({ employee: undefined }))

      expect(client.employee.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: VACATED_EMP },
        select: { unitId: true },
      })
      expect(client.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ unitId: UNIT }) }),
      )
    })
  })

  describe('feasible ranking heuristic', () => {
    it('ranks feasible candidates ascending by scheduled week-hours', async () => {
      const client = makeClient(
        [
          { id: 'busy', preferredShiftStart: [] },
          { id: 'light', preferredShiftStart: [] },
          { id: 'mid', preferredShiftStart: [] },
        ],
        [
          // busy: 16h, mid: 8h, light: 0h in the week.
          { employeeId: 'busy', start: '08:00', end: '16:00' },
          { employeeId: 'busy', start: '08:00', end: '16:00' },
          { employeeId: 'mid', start: '08:00', end: '16:00' },
        ],
      )
      const service = new ReplacementService(allowAll, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result.map((r) => r.employeeId)).toEqual(['light', 'mid', 'busy'])
      expect(result.map((r) => r.rank)).toEqual([1, 2, 3])
      expect(result.map((r) => r.score)).toEqual([0, 8, 16])
      expect(result.every((r) => r.feasible)).toBe(true)
    })

    it('breaks an hours-tie by preferred-start match, then by employeeId', async () => {
      // All three have 0 week-hours and 0 total cost (no rates, no travel). "zeta" matches the shift
      // start (08:00) so it leads despite the later id; "alpha" and "gamma" both miss the preferred
      // start and fall back to id order.
      const client = makeClient([
        { id: 'gamma', preferredShiftStart: ['12:00'] },
        { id: 'alpha', preferredShiftStart: [] },
        { id: 'zeta', preferredShiftStart: ['08:00'] },
      ])
      const service = new ReplacementService(allowAll, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result.map((r) => r.employeeId)).toEqual(['zeta', 'alpha', 'gamma'])
      expect(result.map((r) => r.rank)).toEqual([1, 2, 3])
    })
  })

  describe('infeasible handling', () => {
    it('flags infeasible candidates with the reason and rank 0, listed after feasible ones', async () => {
      const validate = jest.fn().mockImplementation(({ incomingRequesterShiftEmployeeId }) =>
        incomingRequesterShiftEmployeeId === 'blocked'
          ? { feasible: false, reason: 'H4 rest window violated' }
          : { feasible: true },
      )
      const client = makeClient([
        { id: 'blocked', preferredShiftStart: [] },
        { id: 'ok', preferredShiftStart: [] },
      ])
      const service = new ReplacementService({ validate }, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toEqual([
        expect.objectContaining({ employeeId: 'ok', feasible: true, rank: 1, score: 0 }),
        expect.objectContaining({ employeeId: 'blocked', feasible: false, reason: 'H4 rest window violated', rank: 0 }),
      ])
    })

    it('returns every candidate with rank 0 when all are infeasible', async () => {
      const validate = jest.fn().mockResolvedValue({ feasible: false, reason: 'no coverage' })
      const client = makeClient([
        { id: 'a', preferredShiftStart: [] },
        { id: 'b', preferredShiftStart: [] },
      ])
      const service = new ReplacementService({ validate }, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result.every((r) => r.rank === 0 && !r.feasible)).toBe(true)
      expect(result.map((r) => r.employeeId).sort()).toEqual(['a', 'b'])
    })
  })

  describe('empty pool', () => {
    it('returns [] and never calls the validator when no candidate qualifies (local AND cross-unit both empty)', async () => {
      const validate = jest.fn()
      const client = makeClient([])
      const service = new ReplacementService({ validate }, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toEqual([])
      expect(validate).not.toHaveBeenCalled()
      expect(client.shift.findMany).not.toHaveBeenCalled()
    })
  })

  // ----------------------------------------------------------------------------------------------
  // Cross-unit travel (2026-07-14 spec, §12 Etap 1). Coordinates are chosen on the equator so
  // haversine reduces to ~111.32km per degree of longitude/latitude difference — easy to reason
  // about without needing exact great-circle arithmetic.
  // ----------------------------------------------------------------------------------------------
  describe('tiered pool (local -> cross-unit) + H-TRAVEL', () => {
    const LOKALIZACJA = { lat: 0, lng: 0 }

    it('local wins: a feasible local candidate short-circuits cross-unit entirely (0 travel)', async () => {
      const client = makeClient(
        [{ id: 'local-a', preferredShiftStart: [] }],
        [],
        {
          crossPool: [{ id: 'cross-a', preferredShiftStart: [], homeLat: 0, homeLng: 0.01, userId: 'u1' }],
          lokalizacja: LOKALIZACJA,
        },
      )
      const service = new ReplacementService(allowAll, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(expect.objectContaining({ employeeId: 'local-a', feasible: true, rank: 1, travelKm: 0, travelMinutes: 0, travelCost: 0 }))
      // Cross-unit was never even queried — the tiering short-circuit, not just a losing candidate.
      expect(client.lokalizacja.findUnique).not.toHaveBeenCalled()
    })

    it('no local -> cheapest cross-unit wins (closer home = lower travel cost)', async () => {
      const client = makeClient([], [], {
        crossPool: [
          { id: 'far', preferredShiftStart: [], homeLat: 0.9, homeLng: 0, userId: 'u-far' }, // ~100km
          { id: 'near', preferredShiftStart: [], homeLat: 0.05, homeLng: 0, userId: 'u-near' }, // ~5.5km
        ],
        lokalizacja: LOKALIZACJA,
      })
      const service = new ReplacementService(allowAll, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      const feasible = result.filter((r) => r.feasible)
      expect(feasible.map((r) => r.employeeId)).toEqual(['near', 'far'])
      expect(feasible[0]?.rank).toBe(1)
      expect(feasible[0]?.travelKm).toBeLessThan(feasible[1]?.travelKm ?? Infinity)
      expect(feasible[0]?.travelCost).toBeLessThan(feasible[1]?.travelCost ?? Infinity)
    })

    it('over maxTravelMinutes -> infeasible (H-TRAVEL gate), reported with a travel reason', async () => {
      const client = makeClient([], [], {
        crossPool: [{ id: 'toofar', preferredShiftStart: [], homeLat: 3, homeLng: 0, userId: 'u1' }], // ~333km
        lokalizacja: LOKALIZACJA,
      })
      const service = new ReplacementService(allowAll, noCost)

      // Default policy: maxTravelMinutes 120 — ~333km at 60km/h (~333min) is well over the ceiling.
      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toHaveLength(1)
      expect(result[0]?.feasible).toBe(false)
      expect(result[0]?.rank).toBe(0)
      expect(result[0]?.reason).toMatch(/H-TRAVEL/)
    })

    it('none -> escalate: no local and no cross-unit candidate at all yields []', async () => {
      const client = makeClient([], [], { lokalizacja: LOKALIZACJA })
      const service = new ReplacementService(allowAll, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toEqual([])
    })

    it('an H1-H4-infeasible cross-unit candidate is reported with the VALIDATOR reason, not a travel reason', async () => {
      const validate = jest.fn().mockResolvedValue({ feasible: false, reason: 'H2 rest window violated' })
      const client = makeClient([], [], {
        crossPool: [{ id: 'cross-a', preferredShiftStart: [], homeLat: 0.01, homeLng: 0, userId: 'u1' }],
        lokalizacja: LOKALIZACJA,
      })
      const service = new ReplacementService({ validate }, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toEqual([
        expect.objectContaining({ employeeId: 'cross-a', feasible: false, reason: 'H2 rest window violated', travelKm: 0 }),
      ])
    })

    it('a cross-unit candidate with no home coordinates is infeasible (travel cannot be computed)', async () => {
      const client = makeClient([], [], {
        crossPool: [{ id: 'no-home', preferredShiftStart: [], homeLat: null, homeLng: null, userId: 'u1' }],
        lokalizacja: LOKALIZACJA,
      })
      const service = new ReplacementService(allowAll, noCost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result[0]?.feasible).toBe(false)
      expect(result[0]?.reason).toMatch(/H-TRAVEL/)
    })

    it('ranks by TOTAL cost (labour Δ + travel), not travel distance alone', async () => {
      // "costly-labour-near" is much closer (cheap travel) but a far more expensive position; the
      // labour Δcost dwarfs the travel saving, so the FARTHER "cheap-labour-far" (same rate as the
      // vacated employee, Δ=0) wins on total cost despite a higher travel cost.
      const cost: CostService = {
        findRatesForPairs: jest.fn().mockResolvedValue([
          { position: 'BASE', employmentType: 'UOP', hourlyRate: new Decimal(10), currency: 'PLN' },
          { position: 'EXPENSIVE', employmentType: 'UOP', hourlyRate: new Decimal(1000), currency: 'PLN' },
        ]),
        shiftCost: jest.fn((rate: { hourlyRate: number | string }) => new Decimal(rate.hourlyRate)),
      } as unknown as CostService
      const client = makeClient([], [], {
        crossPool: [
          { id: 'cheap-labour-far', preferredShiftStart: [], homeLat: 0.5, homeLng: 0, userId: 'u1' }, // ~55.7km
          { id: 'costly-labour-near', preferredShiftStart: [], homeLat: 0.05, homeLng: 0, userId: 'u2' }, // ~5.6km
        ],
        lokalizacja: LOKALIZACJA,
        costEmployees: [
          { id: VACATED_EMP, position: 'BASE', employmentType: 'UOP' },
          { id: 'cheap-labour-far', position: 'BASE', employmentType: 'UOP' },
          { id: 'costly-labour-near', position: 'EXPENSIVE', employmentType: 'UOP' },
        ],
      })
      const service = new ReplacementService(allowAll, cost)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      const feasible = result.filter((r) => r.feasible)
      expect(feasible.map((r) => r.employeeId)).toEqual(['cheap-labour-far', 'costly-labour-near'])
      expect(feasible[0]?.workCostDelta).toBe(0)
      expect(feasible[1]?.workCostDelta).toBe(990)
    })
  })
})

// ----------------------------------------------------------------------------------------------
// Task 1.2 — vacated-shift detection (approved-leave collision) + role scoping.
// ----------------------------------------------------------------------------------------------

type ScanClient = {
  shift: { findMany: jest.Mock }
  userRole: { findMany: jest.Mock }
}

const asScan = (c: ScanClient) => c as unknown as TenantClient

const HR_ACTOR: AiConfigActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const MANAGER_ACTOR: AiConfigActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.2' }
const RANGE = { from: '2026-07-01', to: '2026-07-31' }

/** A vacated-shift row as Prisma returns it with `employee.leaves` pre-loaded (only APPROVED). */
function scanShift(
  id: string,
  dateIso: string,
  leaves: Array<{ startIso: string; endIso: string }>,
  unitId = 'unit-A',
): VacatedShift {
  return {
    id,
    date: new Date(dateIso),
    employee: {
      unitId,
      leaves: leaves.map((lv, i) => ({
        id: `${id}-lv-${i}`,
        startDate: new Date(lv.startIso),
        endDate: new Date(lv.endIso),
      })),
    },
  } as unknown as VacatedShift
}

function makeScanClient(shifts: VacatedShift[], managedUnits: string[] = []): ScanClient {
  return {
    shift: { findMany: jest.fn().mockResolvedValue(shifts) },
    userRole: { findMany: jest.fn().mockResolvedValue(managedUnits.map((unitId) => ({ unitId }))) },
  }
}

describe('ReplacementService.findVacatedShifts', () => {
  const service = new ReplacementService(allowAll, noCost)

  it('returns a shift whose employee has an APPROVED leave covering the shift date', async () => {
    // Shift on 2026-07-15; leave 07-14..07-16 covers it (closed interval).
    const covered = scanShift('shift-1', '2026-07-15', [{ startIso: '2026-07-14', endIso: '2026-07-16' }])
    const client = makeScanClient([covered])

    const result = await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    expect(result.map((s) => s.id)).toEqual(['shift-1'])
  })

  it('excludes a shift whose loaded leave does NOT cover its own date (closed-interval post-filter)', async () => {
    // Both employees have APPROVED leave overlapping the window, so the DB `some` filter returns
    // both rows — but only the first leave actually covers its shift's date.
    const covered = scanShift('covered', '2026-07-15', [{ startIso: '2026-07-14', endIso: '2026-07-16' }])
    const notCovering = scanShift('gap', '2026-07-15', [{ startIso: '2026-07-20', endIso: '2026-07-25' }])
    const client = makeScanClient([covered, notCovering])

    const result = await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    expect(result.map((s) => s.id)).toEqual(['covered'])
  })

  it('treats the leave interval as CLOSED — endpoints (startDate == date, date == endDate) count', async () => {
    const onStart = scanShift('on-start', '2026-07-10', [{ startIso: '2026-07-10', endIso: '2026-07-12' }])
    const onEnd = scanShift('on-end', '2026-07-12', [{ startIso: '2026-07-10', endIso: '2026-07-12' }])
    const client = makeScanClient([onStart, onEnd])

    const result = await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    expect(result.map((s) => s.id).sort()).toEqual(['on-end', 'on-start'])
  })

  it('only counts APPROVED leave — the DB filter is keyed on status APPROVED (PENDING/REJECTED excluded)', async () => {
    const client = makeScanClient([])

    await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    const where = client.shift.findMany.mock.calls[0][0].where
    expect(where.employee.leaves.some.status).toBe('APPROVED')
    // The selected leaves are likewise narrowed to APPROVED so the post-filter never sees others.
    const select = client.shift.findMany.mock.calls[0][0].select
    expect(select.employee.select.leaves.where.status).toBe('APPROVED')
  })

  it('RODO: the query uses a select (never a bare include) and projects NO pesel/home-address fields', async () => {
    const client = makeScanClient([])

    await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    const call = client.shift.findMany.mock.calls[0][0]
    expect(call.include).toBeUndefined()
    const employeeSelect = call.select.employee.select
    expect(employeeSelect).toEqual({
      id: true,
      unitId: true,
      firstName: true,
      lastName: true,
      position: true,
      leaves: { where: { status: 'APPROVED' }, select: { id: true, startDate: true, endDate: true, status: true, employeeId: true } },
    })
    for (const forbidden of ['pesel', 'peselHash', 'homeAddress', 'homeLat', 'homeLng']) {
      expect(employeeSelect[forbidden]).toBeUndefined()
    }
  })

  it('RODO: a returned vacated shift carries no pesel/home-address keys on its employee', async () => {
    const covered = scanShift('shift-1', '2026-07-15', [{ startIso: '2026-07-14', endIso: '2026-07-16' }])
    const client = makeScanClient([covered])

    const [result] = await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    expect(result).toBeDefined()
    for (const forbidden of ['pesel', 'peselHash', 'homeAddress', 'homeLat', 'homeLng']) {
      expect((result!.employee as Record<string, unknown>)[forbidden]).toBeUndefined()
    }
  })

  it('rejects from > to with a BadRequestException before querying', async () => {
    const client = makeScanClient([])

    await expect(
      service.findVacatedShifts(asScan(client), HR_ACTOR, { from: '2026-07-31', to: '2026-07-01' }),
    ).rejects.toThrow('from must not be after to')
    expect(client.shift.findMany).not.toHaveBeenCalled()
  })

  it('scopes a MANAGER to their managed units via managedUnitIds', async () => {
    const client = makeScanClient([], ['unit-A'])

    await service.findVacatedShifts(asScan(client), MANAGER_ACTOR, RANGE)

    expect(client.userRole.findMany).toHaveBeenCalledWith({
      where: { user: { keycloakSub: 'kc-mgr' }, role: Role.MANAGER, unitId: { not: null } },
      select: { unitId: true },
    })
    const where = client.shift.findMany.mock.calls[0][0].where
    expect(where.employee.unitId).toEqual({ in: ['unit-A'] })
  })

  it('does NOT unit-scope a global HR actor (no managed-unit lookup, no employee.unitId filter)', async () => {
    const client = makeScanClient([])

    await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    expect(client.userRole.findMany).not.toHaveBeenCalled()
    const where = client.shift.findMany.mock.calls[0][0].where
    expect(where.employee.unitId).toBeUndefined()
  })

  it('queries Shift.date within the inclusive [from, to] window', async () => {
    const client = makeScanClient([])

    await service.findVacatedShifts(asScan(client), HR_ACTOR, RANGE)

    const where = client.shift.findMany.mock.calls[0][0].where
    expect(where.date).toEqual({ gte: new Date('2026-07-01'), lte: new Date('2026-07-31') })
  })
})
