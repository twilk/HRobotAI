import { Inject, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  type SwapFeasibilityValidator,
} from '../shift-swap/swap-feasibility-validator.js'

/**
 * One evaluated replacement candidate for a vacated shift. STABLE inter-task contract (later AI
 * phases consume this exact shape): `rank` is 1..n for feasible candidates (best-first), 0 for
 * infeasible ones; `score` is the primary heuristic key (scheduled hours in the shift's ISO week).
 */
export type RankedCandidate = {
  employeeId: string
  feasible: boolean
  reason?: string
  rank: number
  score?: number
}

/**
 * The minimal Shift view {@link ReplacementService.rankCandidatesForShift} needs. `employee.unitId`
 * may be pre-loaded by the caller (via a Prisma `include`); when it is absent the service resolves
 * the unit from `employeeId` itself, so a bare Shift row works too.
 */
export interface RankableShift {
  id: string
  employeeId: string
  role: string
  /** Shift start as "HH:mm" — matched against each candidate's `preferredShiftStart`. */
  start: string
  /** `@db.Date` (UTC midnight) — anchors the ISO week whose hours drive the heuristic. */
  date: Date
  employee?: { unitId: string } | null
}

/** Minutes-since-midnight for an "HH:mm" clock time. */
function toMinutes(clock: string): number {
  const [h, m] = clock.split(':')
  return Number(h) * 60 + Number(m)
}

/** Minutes between two "HH:mm" clock times, wrapping past midnight for an overnight window. */
function windowMinutes(start: string, end: string): number {
  let mins = toMinutes(end) - toMinutes(start)
  if (mins < 0) mins += 24 * 60
  return mins
}

/**
 * The [Monday 00:00, next-Monday 00:00) UTC half-open range of the ISO week containing `date`.
 * `Shift.date` is a `@db.Date` stored at UTC midnight, so the whole computation stays in UTC.
 */
function isoWeekRange(date: Date): { weekStart: Date; weekEndExcl: Date } {
  const day = date.getUTCDay() // 0=Sun .. 6=Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day
  const weekStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetToMonday),
  )
  const weekEndExcl = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { weekStart, weekEndExcl }
}

/**
 * Ranks replacement candidates for a vacated shift (Task 1.1). Builds the eligible pool (same unit,
 * qualified for `shift.role`, excluding the vacated employee), vets each one through the REUSED
 * {@link SwapFeasibilityValidator} seam with a "give away" shape (H1–H4 vetting of the incoming
 * candidate against the vacated shift), and ranks the feasible ones by a deterministic heuristic:
 * fewer already-scheduled hours in the shift's ISO week first, then a preferred-start match, then
 * `employeeId` for a stable tie-break. Infeasible candidates are returned last, flagged with the
 * validator's reason and `rank: 0`. NO mutation, NO proposal is created here.
 */
@Injectable()
export class ReplacementService {
  constructor(
    @Inject(SWAP_FEASIBILITY_VALIDATOR)
    private readonly feasibility: SwapFeasibilityValidator,
  ) {}

  async rankCandidatesForShift(client: TenantClient, shift: RankableShift): Promise<RankedCandidate[]> {
    // The shift's unit = its employee's unit. Prefer a pre-loaded relation; fall back to a lookup.
    const unitId =
      shift.employee?.unitId ??
      (await client.employee.findUniqueOrThrow({ where: { id: shift.employeeId }, select: { unitId: true } }))
        .unitId

    // Pool: same-unit employees qualified for the vacated role, excluding the vacated employee.
    const pool = await client.employee.findMany({
      where: {
        unitId,
        qualifications: { has: shift.role },
        id: { not: shift.employeeId },
      },
      select: { id: true, preferredShiftStart: true },
    })
    if (pool.length === 0) return []

    // Already-scheduled hours per candidate within the shift's ISO week (one query, no N+1).
    const { weekStart, weekEndExcl } = isoWeekRange(shift.date)
    const candidateIds = pool.map((c) => c.id)
    const weekShifts = await client.shift.findMany({
      where: { employeeId: { in: candidateIds }, date: { gte: weekStart, lt: weekEndExcl } },
      select: { employeeId: true, start: true, end: true },
    })
    const hoursByEmployee = new Map<string, number>()
    for (const s of weekShifts) {
      hoursByEmployee.set(s.employeeId, (hoursByEmployee.get(s.employeeId) ?? 0) + windowMinutes(s.start, s.end) / 60)
    }

    // Vet each candidate through the reused feasibility seam with the give-away shape: the candidate
    // is the INCOMING holder of the vacated shift; there is no counterparty shift.
    const feasible: Array<{ id: string; hours: number; prefMatch: number }> = []
    const infeasible: Array<{ id: string; reason?: string }> = []
    for (const candidate of pool) {
      const decision = await this.feasibility.validate({
        client,
        requesterShift: { id: shift.id, employeeId: shift.employeeId },
        targetShift: null,
        incomingRequesterShiftEmployeeId: candidate.id,
        incomingTargetShiftEmployeeId: null,
      })
      if (decision.feasible) {
        feasible.push({
          id: candidate.id,
          hours: hoursByEmployee.get(candidate.id) ?? 0,
          prefMatch: candidate.preferredShiftStart.includes(shift.start) ? 0 : 1,
        })
      } else {
        infeasible.push({ id: candidate.id, reason: decision.reason })
      }
    }

    // Feasible: ascending week-hours, then preferred-start match, then employeeId (stable tie-break).
    feasible.sort(
      (a, b) => a.hours - b.hours || a.prefMatch - b.prefMatch || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    infeasible.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const ranked: RankedCandidate[] = feasible.map((f, i) => ({
      employeeId: f.id,
      feasible: true,
      rank: i + 1,
      score: f.hours,
    }))
    const rejected: RankedCandidate[] = infeasible.map((f) => ({
      employeeId: f.id,
      feasible: false,
      ...(f.reason != null ? { reason: f.reason } : {}),
      rank: 0,
    }))
    return [...ranked, ...rejected]
  }
}
