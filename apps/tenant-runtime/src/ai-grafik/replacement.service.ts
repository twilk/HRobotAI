import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  type SwapFeasibilityValidator,
} from '../shift-swap/swap-feasibility-validator.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import type { AiConfigActor } from './ai-config.service.js'

/**
 * A vacated shift with its assigned employee and that employee's APPROVED leaves pre-loaded — the
 * shape {@link ReplacementService.findVacatedShifts} returns so callers can see WHY the shift is
 * vacated (which leave interval covers it) without a second round-trip.
 *
 * RODO ALLOWLIST projection: a `select` (never a bare `include`) so a future PII column on `Employee`
 * (`pesel`/`peselHash`/`homeAddress`/`homeLat`/`homeLng`) cannot leak into this response just by
 * existing on the model — it must be deliberately added here. Mirrors the `SAFE_SELECT` allowlist
 * `EmployeesService` uses for every other employee read path.
 */
export type VacatedShift = TenantPrisma.ShiftGetPayload<{
  select: {
    id: true
    date: true
    start: true
    end: true
    role: true
    employeeId: true
    lokalizacjaId: true
    employee: {
      select: {
        id: true
        unitId: true
        firstName: true
        lastName: true
        position: true
        leaves: {
          select: {
            id: true
            startDate: true
            endDate: true
            status: true
            employeeId: true
          }
        }
      }
    }
  }
}>

/** The inclusive `[from, to]` calendar-date window (ISO `YYYY-MM-DD`) a vacated-shift scan sweeps. */
export interface ScanRange {
  from: string
  to: string
}

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

  /**
   * Detects vacated shifts in the inclusive `[range.from, range.to]` calendar window (Task 1.2): a
   * scheduled shift whose assigned employee holds an APPROVED {@link TenantPrisma.LeaveRequest}
   * covering the shift's date (CLOSED interval `startDate <= shift.date <= endDate`). RBAC mirrors
   * the config surface: a GLOBAL actor (HR/ADMIN) sees every unit; a MANAGER only shifts whose
   * employee sits in a unit they manage (`managedUnitIds`).
   *
   * The Prisma relation filter narrows at the DB to employees with APPROVED leave overlapping the
   * WINDOW; because a `some` filter can only test the fixed window (not each row's own `shift.date`),
   * a final in-memory pass enforces the exact per-shift closed-interval covering. `Shift.date` and
   * the leave bounds are all `@db.Date` (UTC midnight), so the comparison stays in UTC. DETECTS
   * only — no proposal is created and nothing is mutated.
   *
   * The returned `employee` (and its `leaves`) are a RODO-safe `select` projection — see
   * {@link VacatedShift} — never the full row.
   */
  async findVacatedShifts(client: TenantClient, actor: AiConfigActor, range: ScanRange): Promise<VacatedShift[]> {
    // ISO YYYY-MM-DD strings compare correctly lexicographically; the DTO already validates both are
    // real calendar dates (IsISO8601 strict), so a plain string compare is enough here.
    if (range.from > range.to) throw new BadRequestException('from must not be after to')

    const from = new Date(range.from)
    const to = new Date(range.to)

    // Employee must have APPROVED leave overlapping the window; a MANAGER is further unit-scoped.
    const employeeWhere: TenantPrisma.EmployeeWhereInput = {
      leaves: { some: { status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from } } },
    }
    if (!isGlobal(actor.roles)) {
      employeeWhere.unitId = { in: await managedUnitIds(client, actor.userId) }
    }

    const shifts = await client.shift.findMany({
      where: { date: { gte: from, lte: to }, employee: employeeWhere },
      select: {
        id: true,
        date: true,
        start: true,
        end: true,
        role: true,
        employeeId: true,
        lokalizacjaId: true,
        employee: {
          select: {
            id: true,
            unitId: true,
            firstName: true,
            lastName: true,
            position: true,
            leaves: { where: { status: 'APPROVED' }, select: { id: true, startDate: true, endDate: true, status: true, employeeId: true } },
          },
        },
      },
    })

    // Exact per-shift covering: keep only shifts whose date falls inside a loaded leave's CLOSED
    // interval (the window-level `some` filter above can over-match on a leave that overlaps the
    // window but not this shift's own date).
    return shifts.filter((s) => s.employee.leaves.some((lv) => lv.startDate <= s.date && s.date <= lv.endDate))
  }
}
