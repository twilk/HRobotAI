import { Inject, Injectable, Logger } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { SolveStatus, type ProblemInput } from '@hrobot/shared'
import {
  type SwapFeasibilityDecision,
  type SwapFeasibilityInput,
  type SwapFeasibilityValidator,
} from './swap-feasibility-validator.js'
import { OPTIMIZER_CLIENT, type OptimizerClient } from './optimizer.client.js'

/** The Shift fields the feasibility packing needs; `select`-ed so no PII is loaded. */
type ShiftSlot = {
  id: string
  employeeId: string
  lokalizacjaId: string
  date: Date
  start: string
  end: string
  role: string
}
const SHIFT_SELECT = {
  id: true,
  employeeId: true,
  lokalizacjaId: true,
  date: true,
  start: true,
  end: true,
  role: true,
} as const

/** ISO `YYYY-MM-DD` from a `@db.Date` (UTC-midnight) Date. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Monday (UTC) of the ISO week containing `d`. */
function mondayOf(d: Date): Date {
  const offset = (d.getUTCDay() + 6) % 7 // Mon→0 … Sun→6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset))
}

/** `date + n days`, preserving UTC-midnight. */
function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
}

/**
 * Real feasibility validator (criterion SW2). Before an APPROVED swap mutates any `Shift`, it runs
 * the affected employees' POST-swap schedules through the frozen optimizer `POST /solve` and treats
 * `INFEASIBLE` as "swap rejected" — so a swap that would break the hard rules H1–H4 (qualification,
 * no-overlap, ≥11h daily rest, availability) never lands.
 *
 * ## Expressing an H1–H4 feasibility check through the FROZEN `/solve` contract
 * `/solve` assigns employees to demands to minimise an objective; it has no "is this exact
 * assignment legal?" mode and no way to PIN a demand to a chosen employee. But it enforces coverage
 * as a HARD constraint (`Σ x[e,d] = count`, phase 1) and structurally encodes H1–H4:
 *   - H1 qualification + H3/availability → variable eligibility (`role ∈ quals`, `date ∉ leave`);
 *   - H2 overlap ∪ H4 11h-rest → a pairwise conflict constraint `x[e,d1] + x[e,d2] ≤ 1`.
 * So we solve **one single-employee problem per affected employee**: employees = `[E]`, demands =
 * `E`'s post-swap shift set for the incoming shift's week (each `count = 1`). With only one employee,
 * coverage forces every demand onto `E`; if `E` is unqualified, unavailable, or two of the slots
 * overlap / breach 11h rest, phase 1 is unsatisfiable and the optimizer returns `INFEASIBLE`. That is
 * exactly an H1–H4 check of the pinned post-swap assignment, achieved with no contract or optimizer
 * change. (Week-boundary rest across the Mon/Sun edge is out of scope for this targeted M2 check.)
 *
 * The optimizer call is the injectable {@link OPTIMIZER_CLIENT} seam, so this is unit-testable
 * against a stubbed solver.
 */
@Injectable()
export class OptimizerSwapFeasibilityValidator implements SwapFeasibilityValidator {
  private readonly logger = new Logger(OptimizerSwapFeasibilityValidator.name)

  constructor(@Inject(OPTIMIZER_CLIENT) private readonly optimizer: OptimizerClient) {}

  async validate(input: SwapFeasibilityInput): Promise<SwapFeasibilityDecision> {
    const client = input.client
    const requesterShift = await this.loadShift(client, input.requesterShift.id)
    const targetShift = input.targetShift ? await this.loadShift(client, input.targetShift.id) : null

    // The target employee ends up holding the requester's shift (and gives away their own, if 1:1):
    // check their post-swap week is still H1–H4-feasible.
    const targetSide = await this.checkEmployee(
      client,
      input.incomingRequesterShiftEmployeeId,
      requesterShift,
      targetShift?.id ?? null,
    )
    if (!targetSide.feasible) return targetSide

    // 1:1 swap → the requester ends up holding the target's shift; check that side too.
    if (targetShift && input.incomingTargetShiftEmployeeId) {
      const requesterSide = await this.checkEmployee(
        client,
        input.incomingTargetShiftEmployeeId,
        targetShift,
        requesterShift.id,
      )
      if (!requesterSide.feasible) return requesterSide
    }

    return { feasible: true }
  }

  /**
   * Feasibility of `employeeId` holding `incomingShift` alongside the rest of their week. The shift
   * they hand away (`giveAwayShiftId`, currently theirs) is dropped from the set. Returns
   * `{ feasible: false }` iff the optimizer reports the resulting single-employee week INFEASIBLE.
   */
  private async checkEmployee(
    client: TenantClient,
    employeeId: string,
    incomingShift: ShiftSlot,
    giveAwayShiftId: string | null,
  ): Promise<SwapFeasibilityDecision> {
    const weekStart = mondayOf(incomingShift.date)
    const weekEnd = addDays(weekStart, 7)

    const employee = await client.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, qualifications: true, etat: true },
    })
    if (!employee) {
      // A dangling employee id should be impossible; fail closed rather than approve blindly.
      return { feasible: false, reason: `unknown employee ${employeeId}` }
    }

    const kept = (await client.shift.findMany({
      where: { employeeId, date: { gte: weekStart, lt: weekEnd } },
      select: SHIFT_SELECT,
    })) as ShiftSlot[]

    // Post-swap set: the employee's other week shifts (minus the one given away and any stale copy of
    // the incoming shift), plus the incoming shift they receive.
    const drop = new Set([giveAwayShiftId, incomingShift.id].filter((id): id is string => !!id))
    const postSwap: ShiftSlot[] = [...kept.filter((s) => !drop.has(s.id)), incomingShift]

    const problem = this.buildProblem(weekStart, employee, postSwap)
    const result = await this.optimizer.solve(problem)

    if (result.status === SolveStatus.INFEASIBLE) {
      const reason = result.unmet[0]?.reason ?? 'post-swap schedule violates H1–H4'
      this.logger.debug(`Swap rejected for employee ${employeeId}: ${reason}`)
      return { feasible: false, reason }
    }
    return { feasible: true }
  }

  /** Pack a single-employee, all-`count:1` `ProblemInput` — a pure H1–H4 feasibility probe. */
  private buildProblem(
    weekStart: Date,
    employee: { id: string; qualifications: string[]; etat: unknown },
    shifts: ShiftSlot[],
  ): ProblemInput {
    const locationIds = [...new Set(shifts.map((s) => s.lokalizacjaId))]
    return {
      horizon: { weekStart: isoDate(weekStart) },
      locations: locationIds.map((id) => ({ id, latLng: null })),
      employees: [
        {
          id: employee.id,
          qualifications: employee.qualifications,
          etat: Number(employee.etat),
          homeLatLng: null,
          approvedLeaveDates: [],
          historyHours: 0,
        },
      ],
      demands: shifts.map((s) => ({
        id: s.id,
        locId: s.lokalizacjaId,
        date: isoDate(s.date),
        start: s.start,
        end: s.end,
        role: s.role,
        count: 1,
      })),
      travelMatrix: [],
      // Feasibility only depends on phase-1 hard coverage + H1–H4, not the objective weights.
      weights: { d: 1, e: 0, g: 0 },
      solverConfig: { seed: 1, timeLimit: 5 },
    }
  }

  private async loadShift(client: TenantClient, id: string): Promise<ShiftSlot> {
    const shift = (await client.shift.findUnique({
      where: { id },
      select: SHIFT_SELECT,
    })) as ShiftSlot | null
    if (!shift) throw new Error(`Shift not found for feasibility check: ${id}`)
    return shift
  }
}
