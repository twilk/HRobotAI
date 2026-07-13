import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { ReplacementService, type RankableShift, type VacatedShift } from './replacement.service.js'
import type { SwapFeasibilityValidator } from '../shift-swap/swap-feasibility-validator.js'
import type { AiConfigActor } from './ai-config.service.js'

const UNIT = 'unit-1'
const VACATED_EMP = 'emp-vacated'
const SHIFT_ID = 'shift-1'

type PoolRow = { id: string; preferredShiftStart: string[] }
type WeekShiftRow = { employeeId: string; start: string; end: string }

type MockClient = {
  employee: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock }
  shift: { findMany: jest.Mock }
}

function makeClient(pool: PoolRow[], weekShifts: WeekShiftRow[] = []): MockClient {
  return {
    employee: {
      findMany: jest.fn().mockResolvedValue(pool),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ unitId: UNIT }),
    },
    shift: { findMany: jest.fn().mockResolvedValue(weekShifts) },
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
    date: new Date('2026-07-15T00:00:00.000Z'),
    employee: { unitId: UNIT },
    ...overrides,
  }
}

/** Validator that feasibility-passes everyone (default happy path). */
const allowAll: SwapFeasibilityValidator = { validate: async () => ({ feasible: true }) }

describe('ReplacementService.rankCandidatesForShift', () => {
  describe('pool construction + vetting', () => {
    it('queries same-unit, role-qualified employees excluding the vacated one', async () => {
      const client = makeClient([{ id: 'a', preferredShiftStart: [] }])
      const service = new ReplacementService(allowAll)

      await service.rankCandidatesForShift(as(client), makeShift())

      expect(client.employee.findMany).toHaveBeenCalledWith({
        where: {
          unitId: UNIT,
          qualifications: { has: 'KASJER' },
          id: { not: VACATED_EMP },
        },
        select: { id: true, preferredShiftStart: true },
      })
    })

    it('calls the validator once per pooled candidate with the give-away shape', async () => {
      const validate = jest.fn().mockResolvedValue({ feasible: true })
      const client = makeClient([
        { id: 'a', preferredShiftStart: [] },
        { id: 'b', preferredShiftStart: [] },
      ])
      const service = new ReplacementService({ validate })

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
      const service = new ReplacementService(allowAll)

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
      const service = new ReplacementService(allowAll)

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result.map((r) => r.employeeId)).toEqual(['light', 'mid', 'busy'])
      expect(result.map((r) => r.rank)).toEqual([1, 2, 3])
      expect(result.map((r) => r.score)).toEqual([0, 8, 16])
      expect(result.every((r) => r.feasible)).toBe(true)
    })

    it('breaks an hours-tie by preferred-start match, then by employeeId', async () => {
      // All three have 0 week-hours. "zeta" matches the shift start (08:00) so it leads despite the
      // later id; "alpha" and "gamma" both miss the preferred start and fall back to id order.
      const client = makeClient([
        { id: 'gamma', preferredShiftStart: ['12:00'] },
        { id: 'alpha', preferredShiftStart: [] },
        { id: 'zeta', preferredShiftStart: ['08:00'] },
      ])
      const service = new ReplacementService(allowAll)

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
      const service = new ReplacementService({ validate })

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toEqual([
        { employeeId: 'ok', feasible: true, rank: 1, score: 0 },
        { employeeId: 'blocked', feasible: false, reason: 'H4 rest window violated', rank: 0 },
      ])
    })

    it('returns every candidate with rank 0 when all are infeasible', async () => {
      const validate = jest.fn().mockResolvedValue({ feasible: false, reason: 'no coverage' })
      const client = makeClient([
        { id: 'a', preferredShiftStart: [] },
        { id: 'b', preferredShiftStart: [] },
      ])
      const service = new ReplacementService({ validate })

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result.every((r) => r.rank === 0 && !r.feasible)).toBe(true)
      expect(result.map((r) => r.employeeId).sort()).toEqual(['a', 'b'])
    })
  })

  describe('empty pool', () => {
    it('returns [] and never calls the validator when no candidate qualifies', async () => {
      const validate = jest.fn()
      const client = makeClient([])
      const service = new ReplacementService({ validate })

      const result = await service.rankCandidatesForShift(as(client), makeShift())

      expect(result).toEqual([])
      expect(validate).not.toHaveBeenCalled()
      expect(client.shift.findMany).not.toHaveBeenCalled()
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
  const service = new ReplacementService(allowAll)

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
