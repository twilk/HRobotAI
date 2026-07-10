import { z } from 'zod'

/**
 * Grafik solver contract — the FROZEN envelope exchanged between tenant-runtime (TS) and the
 * grafik-optimizer service (Python/FastAPI). This Zod module and the pydantic models in
 * `grafik-optimizer/app/contract.py` MUST describe the identical shape, field for field.
 *
 * Envelope is frozen for D1: field names/types below are the sync point every dependent track
 * (solver A2, tenant CRUD A3, agent, swaps) builds against. Changes must stay ADDITIVE — new
 * OPTIONAL fields only through D3, never a rename/removal/required-tightening — so an older
 * peer keeps parsing a newer message.
 *
 * Scope notes baked into the shape (context, not implemented here):
 *  - Determinism: `solverConfig.seed` + `timeLimit` let the solver run `num_search_workers=1` with a
 *    fixed seed. Output is reproducible under OPTIMAL; NOT promised bit-identical under a hit
 *    time-limit / FEASIBLE.
 *  - Hard scope: H1–H4 hard + haversine commute + L1 etat-deviation ship now; H5 becomes a soft
 *    ">= N free days/week" proxy; fairness-variance is deferred to M3 (`metrics.fairnessScore` is a
 *    placeholder slot until then).
 *  - RODO: `homeLatLng` is a derived coordinate, not the encrypted `homeAddress` PII itself.
 */

/** Solver outcome. Mirrors CP-SAT status buckets the optimizer collapses to. */
export const SolveStatus = {
  OPTIMAL: 'OPTIMAL',
  FEASIBLE: 'FEASIBLE',
  INFEASIBLE: 'INFEASIBLE',
} as const
export type SolveStatus = (typeof SolveStatus)[keyof typeof SolveStatus]

/** Source of a demand row (parity with Prisma `DemandSource`). */
export const DemandSource = {
  TEMPLATE: 'TEMPLATE',
  MANUAL: 'MANUAL',
} as const
export type DemandSource = (typeof DemandSource)[keyof typeof DemandSource]

// --- shared leaf shapes -------------------------------------------------------------------------

/** WGS84 coordinate used for haversine commute. */
export const LatLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})
export type LatLng = z.infer<typeof LatLngSchema>

// --- ProblemInput -------------------------------------------------------------------------------

/** Planning window. Dates are ISO `YYYY-MM-DD` strings (kept as strings for cross-language parity). */
export const HorizonSchema = z.object({
  /** Monday of the week being solved, ISO date. */
  weekStart: z.string(),
})
export type Horizon = z.infer<typeof HorizonSchema>

/** A schedulable site. `latLng` optional until geocoded. */
export const LocationInputSchema = z.object({
  id: z.string(),
  latLng: LatLngSchema.nullable().optional(),
})
export type LocationInput = z.infer<typeof LocationInputSchema>

/**
 * Soft scheduling preferences for an employee. Both fields are SOFT — the solver optimizes toward
 * them but never hard-guarantees them. ADDITIVE optional extension of the frozen contract; a
 * preference-unaware peer that omits this object stays valid.
 */
export const EmployeePreferencesSchema = z.object({
  /** Weekday codes (`MON`..`SUN`) the employee would rather NOT be scheduled on (soft). */
  preferredDaysOff: z.array(z.string()).optional(),
  /** Preferred shift start times as `HH:mm` strings — shifts starting at these times are preferred (soft). */
  preferredShiftStart: z.array(z.string()).optional(),
})
export type EmployeePreferences = z.infer<typeof EmployeePreferencesSchema>

/** An employee available to the solver, with the inputs H1–H4 + etat-deviation need. */
export const EmployeeInputSchema = z.object({
  id: z.string(),
  /** Roles this employee can cover (matched against demand.role). */
  qualifications: z.array(z.string()),
  /** Contract fraction; targetWeeklyHours = etat × 40. */
  etat: z.number(),
  /** Home coordinate for commute; null when unknown. */
  homeLatLng: LatLngSchema.nullable(),
  /** Approved leave dates (ISO `YYYY-MM-DD`) — H3 hard block. Packed as input, not stored in schema. */
  approvedLeaveDates: z.array(z.string()),
  /** Hours already worked in the reference period, feeding etat-deviation / fairness. */
  historyHours: z.number(),
  /** Soft scheduling preferences (optional; a consumer treats absent as "no preferences"). */
  preferences: EmployeePreferencesSchema.optional(),
})
export type EmployeeInput = z.infer<typeof EmployeeInputSchema>

/** One staffing need: `count` employees of `role` at `locId` for a dated window. */
export const DemandInputSchema = z.object({
  id: z.string(),
  locId: z.string(),
  /** ISO `YYYY-MM-DD`. */
  date: z.string(),
  /** Window start/end as `HH:mm` local time. */
  start: z.string(),
  end: z.string(),
  role: z.string(),
  count: z.number().int(),
})
export type DemandInput = z.infer<typeof DemandInputSchema>

/** One employee→location commute cost (minutes), precomputed via haversine on the caller side. */
export const TravelEntrySchema = z.object({
  employeeId: z.string(),
  locId: z.string(),
  minutes: z.number(),
})
export type TravelEntry = z.infer<typeof TravelEntrySchema>

/**
 * Objective weights. Exact term mapping is owned by the solver (A2); kept as three tunable
 * scalars here: `d` demand/unmet, `e` etat-deviation (L1), `g` geo/commute.
 */
export const WeightsSchema = z.object({
  d: z.number(),
  e: z.number(),
  g: z.number(),
  /**
   * Preference-objective weight (soft employee preferences). OPTIONAL so an older caller sending
   * `{d,e,g}` still validates; a consumer treats a missing `p` as 0 (no preference optimization).
   */
  p: z.number().optional(),
})
export type Weights = z.infer<typeof WeightsSchema>

/** Determinism + budget knobs. `seed` fixes the search; `timeLimit` is seconds. */
export const SolverConfigSchema = z.object({
  seed: z.number().int(),
  timeLimit: z.number(),
})
export type SolverConfig = z.infer<typeof SolverConfigSchema>

/** The full problem handed to `POST /solve`. */
export const ProblemInputSchema = z.object({
  horizon: HorizonSchema,
  locations: z.array(LocationInputSchema),
  employees: z.array(EmployeeInputSchema),
  demands: z.array(DemandInputSchema),
  travelMatrix: z.array(TravelEntrySchema),
  weights: WeightsSchema,
  solverConfig: SolverConfigSchema,
})
export type ProblemInput = z.infer<typeof ProblemInputSchema>

// --- SolveResult --------------------------------------------------------------------------------

/** One employee assigned to one demand. */
export const AssignmentSchema = z.object({
  employeeId: z.string(),
  demandId: z.string(),
})
export type Assignment = z.infer<typeof AssignmentSchema>

/** Objective read-outs. `fairnessScore` is a reserved placeholder until fairness-variance (M3). */
export const MetricsSchema = z.object({
  commuteTotal: z.number(),
  etatDeviation: z.number(),
  fairnessScore: z.number(),
  /**
   * Fraction (0..1) of assignments that honor the assigned employee's preferences; the solver
   * populates it later. OPTIONAL so an existing result without it still validates.
   */
  preferencesHonoredPct: z.number().optional(),
})
export type Metrics = z.infer<typeof MetricsSchema>

/** A demand that could not be (fully) staffed, with a human-readable reason. */
export const UnmetSchema = z.object({
  demandId: z.string(),
  reason: z.string(),
})
export type Unmet = z.infer<typeof UnmetSchema>

/** The result returned by `POST /solve`. */
export const SolveResultSchema = z.object({
  status: z.enum([SolveStatus.OPTIMAL, SolveStatus.FEASIBLE, SolveStatus.INFEASIBLE]),
  assignments: z.array(AssignmentSchema),
  metrics: MetricsSchema,
  unmet: z.array(UnmetSchema),
})
export type SolveResult = z.infer<typeof SolveResultSchema>
