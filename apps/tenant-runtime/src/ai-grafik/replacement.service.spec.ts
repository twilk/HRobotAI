import type { TenantClient } from '@hrobot/db'
import { ReplacementService, type RankableShift } from './replacement.service.js'
import type { SwapFeasibilityValidator } from '../shift-swap/swap-feasibility-validator.js'

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
