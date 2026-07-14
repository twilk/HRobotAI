import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import type { EmploymentType } from '@hrobot/shared'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  type SwapFeasibilityValidator,
} from '../shift-swap/swap-feasibility-validator.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { CostService } from '../cost/cost.service.js'
import { normalizePosition } from '../cost/position.util.js'
import { haversineKm, roundCost, roundKm, roundMinutes, travelCost, travelMinutes } from '../cost/travel.util.js'
import type { AiConfigActor } from './ai-config.service.js'
import { isoWeekRange, toMinutes, windowMinutes } from './week-range.util.js'

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
 * infeasible ones; `score` is the scheduled-hours tie-break key (see the class doc for the full
 * ranking order).
 *
 * (2026-07-14 spec, cross-unit travel) The travel/home/reachability fields are OPTIONAL so a caller
 * constructing a `RankedCandidate` directly (tests, or a future non-engine source) is never forced to
 * populate them; {@link ReplacementService.rankCandidatesForShift} always sets them. RODO: `homeLat`/
 * `homeLng` are carried here ONLY as an internal engine value (never persisted — `AiProposalCandidate`
 * stores just the rounded `travelKm`/`travelMinutes`/`travelCost` derivatives) and must never be
 * serialized to an API response or audit payload.
 */
export type RankedCandidate = {
  employeeId: string
  feasible: boolean
  reason?: string
  rank: number
  score?: number
  /** The candidate's own unit — equals the shift's unit for a local candidate, a different unit for
   *  a cross-unit one. */
  unitId?: string
  /** RODO PII (server-side only) — see the type doc. */
  homeLat?: number | null
  /** RODO PII (server-side only) — see the type doc. */
  homeLng?: number | null
  /** `true` iff the candidate has an `Employee.userId` (a login) — AUTO_ASK_CONSENT can only address
   *  a reachable candidate (Codex P1-3). */
  reachable?: boolean
  /** Rounded km from the candidate's home to the shift's lokalizacja; 0 for a local candidate. */
  travelKm?: number | null
  /** Rounded estimated travel minutes ("szacunkowy dojazd (demo)"); 0 for a local candidate. */
  travelMinutes?: number | null
  /** Rounded estimated travel cost ("kilometrówka"), 2dp; 0 for a local candidate. */
  travelCost?: number | null
  /** Labour Δcost (candidate − vacated) for the shift's hours, when a rate exists for both sides;
   *  `null` when a rate is missing or currencies mismatch. Kept SEPARATE from `travelCost` (Codex
   *  P2-6) — the two are summed only for the ranking sort key, never persisted as one number. */
  workCostDelta?: number | null
}

/**
 * Cross-unit replacement travel policy (2026-07-14 spec) — mirrors `AiSchedulingConfig`'s travel
 * columns. {@link ReplacementService.rankCandidatesForShift} accepts this as an explicit parameter
 * (defaulting to {@link DEFAULT_TRAVEL_POLICY}) rather than reading `AiSchedulingConfig` itself, so
 * the engine stays a pure/testable seam — the caller (`AiProposalService`) is responsible for
 * resolving the unit's actual configured policy and passing it in.
 */
export interface TravelPolicy {
  /** Assumed average driving speed (km/h), used to derive minutes from {@link haversineKm}. */
  avgSpeedKmh: number
  /** Per-km travel reimbursement rate ("kilometrówka"), PLN. */
  perKmRatePln: number
  /** H-TRAVEL hard feasibility ceiling, in minutes. */
  maxTravelMinutes: number
  /** Whether travel cost prices a there-and-back trip (×2) or the one-way leg only. */
  roundTrip: boolean
}

/** Mirrors the `AiSchedulingConfig` schema column defaults (see `ai-config.service.ts`). */
export const DEFAULT_TRAVEL_POLICY: TravelPolicy = {
  avgSpeedKmh: 60,
  perKmRatePln: 1.15,
  maxTravelMinutes: 120,
  roundTrip: true,
}

/**
 * H4's ≥11h daily rest (see `OptimizerSwapFeasibilityValidator`), mirrored here for the H-TRAVEL
 * arrival-gap check (Codex finding 1, 2026-07-14 spec §12 Etap 1): a cross-unit candidate must not
 * only be within `maxTravelMinutes`, they must actually be able to REACH the vacated shift's start
 * given any nearby shift they already hold that week — end-of-that-shift + this rest + the travel
 * itself must fit before `shift.start`.
 */
const REQUIRED_REST_MINUTES = 11 * 60

/**
 * The minimal Shift view {@link ReplacementService.rankCandidatesForShift} needs. `employee.unitId`
 * may be pre-loaded by the caller (via a Prisma `include`); when it is absent the service resolves
 * the unit from `employeeId` itself, so a bare Shift row works too. Same optional-preload convention
 * for `lokalizacja` (the shift's site lat/lng, needed for cross-unit travel) — absent triggers a
 * lazy lookup, and ONLY when a cross-unit candidate is actually being evaluated (a local-only
 * resolution never touches `lokalizacja` at all).
 */
export interface RankableShift {
  id: string
  employeeId: string
  role: string
  /** Shift start as "HH:mm" — matched against each candidate's `preferredShiftStart`. */
  start: string
  /** Shift end as "HH:mm" — needed (with `start`) for the labour Δcost hours calc. */
  end: string
  /** `@db.Date` (UTC midnight) — anchors the ISO week whose hours drive the heuristic. */
  date: Date
  /** The shift's site — travel is computed to THIS lokalizacja's lat/lng, not the candidate's unit. */
  lokalizacjaId: string
  employee?: { unitId: string } | null
  lokalizacja?: { lat: number | null; lng: number | null } | null
}

/** A pooled candidate row before feasibility vetting — the fields {@link ReplacementService} needs
 *  from either the local or the cross-unit query (same shape for both). */
interface PoolRow {
  id: string
  preferredShiftStart: string[]
  unitId: string
  homeLat: number | null
  homeLng: number | null
  userId: string | null
}

/** One vetted candidate — H1-H4 (+ H-TRAVEL for cross-unit) decision, travel breakdown, tie-break
 *  inputs — before the final cost-based sort/rank pass. */
interface EvaluatedCandidate {
  id: string
  feasible: boolean
  reason?: string
  unitId: string
  homeLat: number | null
  homeLng: number | null
  reachable: boolean
  travelKm: number
  travelMinutes: number
  travelCost: number
  prefMatch: number
}

/**
 * Ranks replacement candidates for a vacated shift (Task 1.1; cross-unit travel: 2026-07-14 spec).
 * Builds a TIERED eligible pool:
 *
 *   1. **Local** — same unit as the shift, qualified for `shift.role`, excluding the vacated
 *      employee. `travelKm/Minutes/Cost` are always 0.
 *   2. **Cross-unit** — ONLY queried when tier 1 has zero FEASIBLE candidates (Codex recommendation:
 *      cheaper computationally, clearer narrative than always pooling both). Qualified employees from
 *      every OTHER unit. Vetted through the same H1–H4 {@link SwapFeasibilityValidator} seam as tier
 *      1, PLUS an additive engine-side **H-TRAVEL** gate: infeasible when the candidate's home or the
 *      shift's lokalizacja has no coordinates (travel cannot be computed), or when the estimated
 *      travel time exceeds `travelPolicy.maxTravelMinutes`.
 *
 * Both tiers reuse the SAME {@link SwapFeasibilityValidator} "give away" shape (H1–H4 vetting of the
 * incoming candidate against the vacated shift) — untouched by this change. Feasible candidates
 * (across whichever tier(s) were evaluated) are ranked ascending by TOTAL cost — labour Δcost
 * (candidate − vacated, when a rate exists for both) PLUS travel cost — then the pre-existing
 * tie-breaks: fewer already-scheduled hours in the shift's ISO week, then a preferred-start match,
 * then `employeeId` for a stable order. A local candidate's total cost is 0 (or the labour Δ alone)
 * whenever cost rates are unset, so this degrades EXACTLY to the original hours/pref/id ordering in
 * that case. Infeasible candidates are returned last (rank 0), flagged with the vetting reason.
 * NO mutation, NO proposal is created here.
 */
@Injectable()
export class ReplacementService {
  constructor(
    @Inject(SWAP_FEASIBILITY_VALIDATOR)
    private readonly feasibility: SwapFeasibilityValidator,
    private readonly costService: CostService,
  ) {}

  async rankCandidatesForShift(
    client: TenantClient,
    shift: RankableShift,
    travelPolicy: TravelPolicy = DEFAULT_TRAVEL_POLICY,
  ): Promise<RankedCandidate[]> {
    // The shift's unit = its employee's unit. Prefer a pre-loaded relation; fall back to a lookup.
    const unitId =
      shift.employee?.unitId ??
      (await client.employee.findUniqueOrThrow({ where: { id: shift.employeeId }, select: { unitId: true } }))
        .unitId

    // --- Tier 1: local pool (same unit, qualified, ≠ vacated). Always evaluated. Local candidates
    // never travel, so no week-shift data is needed to vet them. -------------------------------------
    const localPool = await this.loadPool(client, { unitId, role: shift.role, excludeId: shift.employeeId, crossUnit: false })
    let localEvaluated: EvaluatedCandidate[] = []
    if (localPool.length > 0) {
      localEvaluated = await Promise.all(
        localPool.map((c) => this.vetCandidate(client, shift, c, true, null, travelPolicy, [])),
      )
    }
    const localFeasible = localEvaluated.filter((c) => c.feasible)

    // --- Tier 2 pool: cross-unit — ONLY when tier 1 has no feasible candidate. lokalizacja is
    // resolved lazily HERE (never for a local-only resolution) since it's only needed for H-TRAVEL. --
    let crossPool: PoolRow[] = []
    let lokalizacja: { lat: number | null; lng: number | null } | null = null
    if (localFeasible.length === 0) {
      crossPool = await this.loadPool(client, { unitId, role: shift.role, excludeId: shift.employeeId, crossUnit: true })
      if (crossPool.length > 0) {
        lokalizacja =
          shift.lokalizacja !== undefined
            ? shift.lokalizacja
            : await client.lokalizacja.findUnique({ where: { id: shift.lokalizacjaId }, select: { lat: true, lng: true } })
      }
    }

    const poolIds = [...localPool, ...crossPool].map((c) => c.id)
    if (poolIds.length === 0) return []

    // Already-scheduled shifts per candidate within the shift's ISO week — ONE query (no N+1), fetched
    // BEFORE cross-unit vetting so it can double as the H-TRAVEL arrival-gap input (does the candidate
    // have a nearby shift that, plus rest plus travel, doesn't leave enough room before `shift.start`?
    // Codex finding 1) as well as the hours tie-break used later for every evaluated candidate.
    const { weekStart, weekEndExcl } = isoWeekRange(shift.date)
    const weekShifts = await client.shift.findMany({
      where: { employeeId: { in: poolIds }, date: { gte: weekStart, lt: weekEndExcl } },
      select: { employeeId: true, start: true, end: true, date: true },
    })
    const weekShiftsByEmployee = new Map<string, { start: string; end: string; date: Date }[]>()
    const hoursByEmployee = new Map<string, number>()
    for (const s of weekShifts) {
      const list = weekShiftsByEmployee.get(s.employeeId) ?? []
      list.push(s)
      weekShiftsByEmployee.set(s.employeeId, list)
      hoursByEmployee.set(s.employeeId, (hoursByEmployee.get(s.employeeId) ?? 0) + windowMinutes(s.start, s.end) / 60)
    }

    let crossEvaluated: EvaluatedCandidate[] = []
    if (crossPool.length > 0) {
      crossEvaluated = await Promise.all(
        crossPool.map((c) =>
          this.vetCandidate(client, shift, c, false, lokalizacja, travelPolicy, weekShiftsByEmployee.get(c.id) ?? []),
        ),
      )
    }

    const evaluated = [...localEvaluated, ...crossEvaluated]

    // Labour Δcost (candidate − vacated) for every FEASIBLE candidate, one batched rates query
    // (Codex P2-6: kept SEPARATE from travelCost — summed only for the sort key below).
    const feasibleEvaluated = evaluated.filter((c) => c.feasible)
    const workCostByEmployee = await this.computeWorkCostDeltas(client, shift, feasibleEvaluated.map((c) => c.id))

    const feasible = feasibleEvaluated.map((c) => {
      const hours = hoursByEmployee.get(c.id) ?? 0
      const workCostDelta = workCostByEmployee.get(c.id) ?? null
      const totalCost = (workCostDelta ?? 0) + c.travelCost
      return { ...c, hours, workCostDelta, totalCost }
    })
    const infeasible = evaluated.filter((c) => !c.feasible)

    // Feasible: ascending total cost, then week-hours, then preferred-start match, then employeeId.
    feasible.sort(
      (a, b) =>
        a.totalCost - b.totalCost ||
        a.hours - b.hours ||
        a.prefMatch - b.prefMatch ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    infeasible.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const ranked: RankedCandidate[] = feasible.map((f, i) => ({
      employeeId: f.id,
      feasible: true,
      rank: i + 1,
      score: f.hours,
      unitId: f.unitId,
      homeLat: f.homeLat,
      homeLng: f.homeLng,
      reachable: f.reachable,
      travelKm: f.travelKm,
      travelMinutes: f.travelMinutes,
      travelCost: f.travelCost,
      workCostDelta: f.workCostDelta,
    }))
    const rejected: RankedCandidate[] = infeasible.map((f) => ({
      employeeId: f.id,
      feasible: false,
      ...(f.reason != null ? { reason: f.reason } : {}),
      rank: 0,
      unitId: f.unitId,
      homeLat: f.homeLat,
      homeLng: f.homeLng,
      reachable: f.reachable,
      travelKm: f.travelKm,
      travelMinutes: f.travelMinutes,
      travelCost: f.travelCost,
    }))
    return [...ranked, ...rejected]
  }

  /** Same-unit (`crossUnit: false`) or every-other-unit (`crossUnit: true`) qualified pool, with the
   *  fields both tiers' vetting needs (home coords + login for travel/reachability). */
  private async loadPool(
    client: TenantClient,
    opts: { unitId: string; role: string; excludeId: string; crossUnit: boolean },
  ): Promise<PoolRow[]> {
    return client.employee.findMany({
      where: {
        unitId: opts.crossUnit ? { not: opts.unitId } : opts.unitId,
        qualifications: { has: opts.role },
        id: { not: opts.excludeId },
      },
      select: { id: true, preferredShiftStart: true, unitId: true, homeLat: true, homeLng: true, userId: true },
    })
  }

  /**
   * Vets one candidate through the reused H1–H4 {@link SwapFeasibilityValidator} seam (give-away
   * shape — the candidate is the INCOMING holder of the vacated shift, no counterparty shift), then
   * for a CROSS-UNIT candidate applies the additive H-TRAVEL gate: infeasible when either the
   * candidate's home or the shift's lokalizacja has no coordinates (travel cannot be honestly
   * computed), when the estimated travel time exceeds `travelPolicy.maxTravelMinutes`, OR (Codex
   * finding 1, §12 Etap 1) when the candidate's nearest preceding shift in `candidateWeekShifts`
   * doesn't leave enough gap — end-of-that-shift + the H4 ≥11h rest + the travel itself — before
   * `shift.start` (see {@link checkArrivalGap}). A LOCAL candidate's travel is always 0 and is never
   * travel- or arrival-gated.
   */
  private async vetCandidate(
    client: TenantClient,
    shift: RankableShift,
    candidate: PoolRow,
    isLocal: boolean,
    lokalizacja: { lat: number | null; lng: number | null } | null,
    travelPolicy: TravelPolicy,
    candidateWeekShifts: { start: string; end: string; date: Date }[],
  ): Promise<EvaluatedCandidate> {
    const decision = await this.feasibility.validate({
      client,
      requesterShift: { id: shift.id, employeeId: shift.employeeId },
      targetShift: null,
      incomingRequesterShiftEmployeeId: candidate.id,
      incomingTargetShiftEmployeeId: null,
    })
    const reachable = candidate.userId != null
    const prefMatch = candidate.preferredShiftStart.includes(shift.start) ? 0 : 1
    const base = {
      id: candidate.id,
      unitId: candidate.unitId,
      homeLat: candidate.homeLat,
      homeLng: candidate.homeLng,
      reachable,
      prefMatch,
    }

    if (isLocal || !decision.feasible) {
      return {
        ...base,
        feasible: decision.feasible,
        ...(decision.reason != null ? { reason: decision.reason } : {}),
        travelKm: 0,
        travelMinutes: 0,
        travelCost: 0,
      }
    }

    // Cross-unit + H1-H4 feasible: apply the additive H-TRAVEL gate.
    if (candidate.homeLat == null || candidate.homeLng == null || lokalizacja?.lat == null || lokalizacja?.lng == null) {
      return {
        ...base,
        feasible: false,
        reason: 'H-TRAVEL: brak współrzędnych do wyliczenia dojazdu',
        travelKm: 0,
        travelMinutes: 0,
        travelCost: 0,
      }
    }

    const rawKm = haversineKm(candidate.homeLat, candidate.homeLng, lokalizacja.lat, lokalizacja.lng)
    const rawMinutes = travelMinutes(rawKm, travelPolicy.avgSpeedKmh)
    if (rawMinutes > travelPolicy.maxTravelMinutes) {
      return {
        ...base,
        feasible: false,
        reason: `H-TRAVEL: szacunkowy dojazd ~${roundMinutes(rawMinutes)} min przekracza limit ${travelPolicy.maxTravelMinutes} min`,
        travelKm: roundKm(rawKm),
        travelMinutes: roundMinutes(rawMinutes),
        travelCost: 0,
      }
    }

    // Within the travel-time ceiling; still must actually be able to ARRIVE on time given any nearby
    // shift already held that week (Codex finding 1) — the ceiling alone doesn't check this.
    const gapReason = this.checkArrivalGap(shift, rawMinutes, candidateWeekShifts)
    if (gapReason != null) {
      return {
        ...base,
        feasible: false,
        reason: gapReason,
        travelKm: roundKm(rawKm),
        travelMinutes: roundMinutes(rawMinutes),
        travelCost: 0,
      }
    }

    const costDecimal = travelCost(rawKm, travelPolicy.perKmRatePln, travelPolicy.roundTrip)
    return {
      ...base,
      feasible: true,
      travelKm: roundKm(rawKm),
      travelMinutes: roundMinutes(rawMinutes),
      travelCost: roundCost(costDecimal).toNumber(),
    }
  }

  /**
   * H-TRAVEL arrival gap (Codex finding 1): among `candidateWeekShifts` (the candidate's OTHER shifts
   * in the vacated shift's ISO week), finds the one ending closest to — but no later than — the
   * vacated shift's start, and checks that end-of-that-shift + {@link REQUIRED_REST_MINUTES} +
   * `travelMins` still fits before `shift.start`. Absolute instants are `shift.date` (UTC-midnight
   * `@db.Date`) plus minutes-since-midnight, so an overnight shift (`end < start`) is handled the same
   * way {@link windowMinutes} already handles it elsewhere in this file. Returns `null` (no conflict)
   * when the candidate has no shift ending at/before the vacated shift's start that week.
   */
  private checkArrivalGap(
    shift: RankableShift,
    travelMins: number,
    candidateWeekShifts: { start: string; end: string; date: Date }[],
  ): string | null {
    const vacatedStartAbs = shift.date.getTime() + toMinutes(shift.start) * 60_000
    let latestPrevEndAbs: number | null = null
    for (const s of candidateWeekShifts) {
      const startAbs = s.date.getTime() + toMinutes(s.start) * 60_000
      const endAbs = startAbs + windowMinutes(s.start, s.end) * 60_000
      if (endAbs <= vacatedStartAbs && (latestPrevEndAbs == null || endAbs > latestPrevEndAbs)) {
        latestPrevEndAbs = endAbs
      }
    }
    if (latestPrevEndAbs == null) return null

    const gapMinutes = (vacatedStartAbs - latestPrevEndAbs) / 60_000
    const requiredMinutes = REQUIRED_REST_MINUTES + travelMins
    if (gapMinutes >= requiredMinutes) return null

    return (
      `H-TRAVEL: poprzednia zmiana kończy się za blisko startu — dostępne ${Math.round(gapMinutes)} min ` +
      `(odpoczynek+dojazd), wymagane ${Math.round(requiredMinutes)} min`
    )
  }

  /**
   * Labour Δcost (candidate − vacated) for every id in `candidateIds`, batched into ONE
   * position/employmentType lookup plus ONE rates query (mirrors `AiProposalService`'s
   * `computeEstimatedCost`, generalized to N candidates instead of just the top one). A candidate is
   * OMITTED from the returned map (⇒ `null` at the call site) whenever the vacated employee's rate or
   * that candidate's own rate is missing, or the two rates' currencies mismatch — never a phantom 0.
   */
  private async computeWorkCostDeltas(
    client: TenantClient,
    shift: { employeeId: string; start: string; end: string },
    candidateIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    if (candidateIds.length === 0) return result

    const employees = await client.employee.findMany({
      where: { id: { in: [...candidateIds, shift.employeeId] } },
      select: { id: true, position: true, employmentType: true },
    })
    const byId = new Map(employees.map((e) => [e.id, e]))
    const vacatedEmp = byId.get(shift.employeeId)
    if (!vacatedEmp) return result

    // Codex finding 3: normalize on BOTH sides of the map (build via `rates`' own position, and every
    // lookup below) so a whitespace-only difference from the raw `Employee.position` never silently
    // misses the rate — mirrors `AiProposalService.computeEstimatedCost` and `CostService.weekCost`.
    const pairKey = (position: string, employmentType: EmploymentType) =>
      `${normalizePosition(position)} ${employmentType}`
    const pairs = candidateIds
      .map((id) => byId.get(id))
      .filter((e): e is NonNullable<typeof e> => e != null)
      .map((e) => ({ position: e.position, employmentType: e.employmentType as EmploymentType }))
    pairs.push({ position: vacatedEmp.position, employmentType: vacatedEmp.employmentType as EmploymentType })

    const rates = await this.costService.findRatesForPairs(client, pairs)
    const rateByKey = new Map(rates.map((r) => [pairKey(r.position, r.employmentType as EmploymentType), r]))
    const vacatedRate = rateByKey.get(pairKey(vacatedEmp.position, vacatedEmp.employmentType as EmploymentType))
    if (!vacatedRate) return result
    const vacatedCost = this.costService.shiftCost(vacatedRate, shift)

    for (const id of candidateIds) {
      const emp = byId.get(id)
      if (!emp) continue
      const rate = rateByKey.get(pairKey(emp.position, emp.employmentType as EmploymentType))
      if (!rate || rate.currency !== vacatedRate.currency) continue
      const candidateCost = this.costService.shiftCost(rate, shift)
      result.set(id, candidateCost.sub(vacatedCost).toNumber())
    }
    return result
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
