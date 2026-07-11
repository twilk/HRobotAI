import type { TenantClient } from '@hrobot/db'
import { SolveStatus, type ProblemInput, type SolveResult } from '@hrobot/shared'
import { OptimizerSwapFeasibilityValidator } from './optimizer-swap-feasibility.validator.js'
import type { OptimizerClient } from './optimizer.client.js'
import type { SwapFeasibilityInput } from './swap-feasibility-validator.js'
import { ShiftSwapService } from './shift-swap.service.js'
import { SwapState, SwapNotFeasibleError } from './swap-state-machine.js'

/**
 * SW2 (unit): the REAL validator packs each affected employee's post-swap week into the frozen
 * `ProblemInput` and treats optimizer `INFEASIBLE` as "swap rejected". The optimizer is stubbed so no
 * live solver is needed; we assert both the verdict mapping and the shape of the packed problem.
 */

const REQ_SHIFT = { id: 'shift-req', employeeId: 'emp-req', lokalizacjaId: 'loc-1', date: new Date('2026-07-13'), start: '08:00', end: '16:00', role: 'NURSE' }
const TGT_SHIFT = { id: 'shift-tgt', employeeId: 'emp-tgt', lokalizacjaId: 'loc-1', date: new Date('2026-07-14'), start: '08:00', end: '16:00', role: 'NURSE' }

const EMPLOYEES: Record<string, { id: string; qualifications: string[]; etat: number }> = {
  'emp-req': { id: 'emp-req', qualifications: ['NURSE'], etat: 1 },
  'emp-tgt': { id: 'emp-tgt', qualifications: ['NURSE'], etat: 1 },
}
const SHIFTS: Record<string, typeof REQ_SHIFT> = { 'shift-req': REQ_SHIFT, 'shift-tgt': TGT_SHIFT }

type LeaveRow = { employeeId: string; startDate: Date; endDate: Date }

/**
 * Minimal in-memory client covering exactly the reads the validator makes. `shift.findMany` honours
 * the `date` window so the widened ±1-day probe (B2) is observable, and `leaveRequest.findMany`
 * returns the configured APPROVED-leave rows for the queried employee (B1).
 */
function makeClient(extraShifts: Array<typeof REQ_SHIFT> = [], leaveRows: LeaveRow[] = []): TenantClient {
  return {
    shift: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => SHIFTS[where.id] ?? null),
      findMany: jest.fn(
        ({ where }: { where: { employeeId: string; date: { gte: Date; lt: Date } } }) =>
          extraShifts.filter(
            (s) =>
              s.employeeId === where.employeeId &&
              s.date >= where.date.gte &&
              s.date < where.date.lt,
          ),
      ),
    },
    employee: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => EMPLOYEES[where.id] ?? null),
    },
    leaveRequest: {
      findMany: jest.fn(({ where }: { where: { employeeId: string } }) =>
        leaveRows
          .filter((lv) => lv.employeeId === where.employeeId)
          .map((lv) => ({ startDate: lv.startDate, endDate: lv.endDate })),
      ),
    },
  } as unknown as TenantClient
}

function makeInput(client: TenantClient, giveAway = false): SwapFeasibilityInput {
  return {
    client,
    requesterShift: { id: REQ_SHIFT.id, employeeId: REQ_SHIFT.employeeId },
    targetShift: giveAway ? null : { id: TGT_SHIFT.id, employeeId: TGT_SHIFT.employeeId },
    incomingRequesterShiftEmployeeId: 'emp-tgt',
    incomingTargetShiftEmployeeId: giveAway ? null : 'emp-req',
  }
}

const okResult = (): SolveResult => ({
  status: SolveStatus.OPTIMAL,
  assignments: [],
  metrics: { commuteTotal: 0, etatDeviation: 0, fairnessScore: 0 },
  unmet: [],
})
const infeasibleResult = (reason: string): SolveResult => ({
  status: SolveStatus.INFEASIBLE,
  assignments: [],
  metrics: { commuteTotal: 0, etatDeviation: 0, fairnessScore: 0 },
  unmet: [{ demandId: 'shift-req', reason }],
})

describe('OptimizerSwapFeasibilityValidator (SW2)', () => {
  let optimizer: { solve: jest.Mock<Promise<SolveResult>, [ProblemInput]> }
  let validator: OptimizerSwapFeasibilityValidator

  beforeEach(() => {
    optimizer = { solve: jest.fn() }
    validator = new OptimizerSwapFeasibilityValidator(optimizer as unknown as OptimizerClient)
  })

  it('rejects the swap when the optimizer returns INFEASIBLE (H1–H4 broken)', async () => {
    optimizer.solve.mockResolvedValue(infeasibleResult('role NURSE uncoverable — daily rest'))
    const decision = await validator.validate(makeInput(makeClient()))
    expect(decision.feasible).toBe(false)
    expect(decision.reason).toContain('daily rest')
  })

  it('allows the swap when both affected employees solve feasibly', async () => {
    optimizer.solve.mockResolvedValue(okResult())
    const decision = await validator.validate(makeInput(makeClient()))
    expect(decision.feasible).toBe(true)
    // 1:1 swap → both sides probed.
    expect(optimizer.solve).toHaveBeenCalledTimes(2)
  })

  it('packs a single-employee, count-1 ProblemInput containing the INCOMING shift', async () => {
    optimizer.solve.mockResolvedValue(okResult())
    await validator.validate(makeInput(makeClient()))

    // First probe = target employee receiving the requester's shift.
    const problem = optimizer.solve.mock.calls[0]![0]
    expect(problem.employees).toHaveLength(1)
    expect(problem.employees[0]!.id).toBe('emp-tgt')
    expect(problem.demands.every((d) => d.count === 1)).toBe(true)
    const demandIds = problem.demands.map((d) => d.id)
    expect(demandIds).toContain('shift-req') // the incoming shift is present
    expect(problem.horizon.weekStart).toBe('2026-07-13') // Monday of the incoming shift
  })

  it('keeps other week shifts, drops the given-away shift, adds the incoming shift', async () => {
    const otherTgtShift = { ...REQ_SHIFT, id: 'shift-tgt-other', employeeId: 'emp-tgt', date: new Date('2026-07-15'), start: '08:00', end: '16:00' }
    optimizer.solve.mockResolvedValue(okResult())
    // emp-tgt's week holds their given-away shift (TGT_SHIFT) + another kept shift.
    await validator.validate(makeInput(makeClient([TGT_SHIFT, otherTgtShift])))

    const problem = optimizer.solve.mock.calls[0]![0]
    const demandIds = problem.demands.map((d) => d.id).sort()
    // shift-tgt (given away) dropped; shift-tgt-other kept; shift-req (incoming) added.
    expect(demandIds).toEqual(['shift-req', 'shift-tgt-other'])
  })

  it('give-away (no target shift) probes only the receiving employee once', async () => {
    optimizer.solve.mockResolvedValue(okResult())
    const decision = await validator.validate(makeInput(makeClient(), true))
    expect(decision.feasible).toBe(true)
    expect(optimizer.solve).toHaveBeenCalledTimes(1)
  })

  // B1 (H3): the receiving employee's APPROVED leave for the probe week is threaded into the packed
  // problem as `approvedLeaveDates`, so a swap can never place them onto an approved-leave day.
  it('threads the receiving employee’s APPROVED leave into approvedLeaveDates (B1 / H3)', async () => {
    optimizer.solve.mockResolvedValue(okResult())
    // emp-tgt is on approved leave the very day they would receive the requester's Monday shift.
    const leave = [{ employeeId: 'emp-tgt', startDate: new Date('2026-07-13'), endDate: new Date('2026-07-13') }]
    await validator.validate(makeInput(makeClient([], leave)))

    const problem = optimizer.solve.mock.calls[0]![0]
    expect(problem.employees[0]!.id).toBe('emp-tgt')
    expect(problem.employees[0]!.approvedLeaveDates).toContain('2026-07-13')
  })

  // B2 (H4): the ±1-day widened window pulls in the neighbouring Sunday shift that shares a week
  // boundary with the incoming Monday shift, so the pairwise 11h-rest constraint can bind across it.
  it('includes the neighbouring Sunday shift so week-boundary 11h rest is checked (B2)', async () => {
    // emp-tgt already works Sun 15:00–23:00 (2026-07-12); the incoming shift is Mon 08:00 (<11h rest).
    const sundayShift = { ...REQ_SHIFT, id: 'shift-sun', employeeId: 'emp-tgt', date: new Date('2026-07-12'), start: '15:00', end: '23:00' }
    optimizer.solve.mockResolvedValue(okResult())
    await validator.validate(makeInput(makeClient([sundayShift])))

    const problem = optimizer.solve.mock.calls[0]![0]
    const demandIds = problem.demands.map((d) => d.id)
    expect(demandIds).toContain('shift-sun') // boundary neighbour now packed (was excluded pre-B2)
    expect(demandIds).toContain('shift-req') // alongside the incoming shift
  })

  // SW2 end-to-end: an INFEASIBLE optimizer verdict blocks the real service's approve path — the
  // request never reaches APPROVED and NO Shift row is mutated (no transaction runs).
  it('blocks approval through the service and leaves shifts untouched', async () => {
    optimizer.solve.mockResolvedValue(infeasibleResult('post-swap schedule violates H1–H4'))
    const service = new ShiftSwapService(validator)

    const request = {
      id: 'req-1',
      requesterEmployeeId: 'emp-req',
      requesterShiftId: 'shift-req',
      targetEmployeeId: 'emp-tgt',
      targetShiftId: 'shift-tgt',
      state: SwapState.PENDING_MANAGER,
    }
    const shiftUpdate = jest.fn()
    const txn = jest.fn()
    const client = {
      shiftSwapRequest: { findUnique: jest.fn(async () => request), update: jest.fn() },
      shift: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => SHIFTS[where.id] ?? null),
        findMany: jest.fn(async () => []),
        update: shiftUpdate,
      },
      employee: { findUnique: jest.fn(({ where }: { where: { id: string } }) => EMPLOYEES[where.id] ?? null) },
      leaveRequest: { findMany: jest.fn(async () => []) },
      $transaction: txn,
    } as unknown as TenantClient

    await expect(
      service.managerDecision(client, 'req-1', {
        approve: true,
        decidedByManagerId: 'mgr-1',
        actorUserId: 'user-mgr',
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(SwapNotFeasibleError)

    expect(txn).not.toHaveBeenCalled()
    expect(shiftUpdate).not.toHaveBeenCalled()
  })
})
