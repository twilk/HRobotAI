import {
  ProblemInputSchema,
  type DemandInput,
  type EmployeeInput,
  type LocationInput,
  type ProblemInput,
  type TravelEntry,
} from '@hrobot/shared'
import type { CanonicalSeed } from '@hrobot/db'
import { commuteMinutes } from './reuse/haversine.js'

/**
 * Pack a canonical-seed slice into a frozen `ProblemInput`, mirroring
 * `GrafikService.solveGrafik` field-for-field (apps/tenant-runtime/src/grafik/grafik.service.ts) so
 * the cold-start problems are byte-shaped like what `POST /grafik/solve` sends the optimizer.
 *
 * Parity with the runtime packer:
 *  - demands: the week's rows (optionally narrowed to `lokalizacjaIds`) → `{id, locId, date, start,
 *    end, role, count}`.
 *  - employees: ALL seed employees (the runtime scopes by unit; here every problem uses the full
 *    pool) → `{id, qualifications, etat, homeLatLng, approvedLeaveDates, historyHours: 0}`.
 *    `historyHours` is 0 for the same DATA-GAP reason the runtime notes (no AttendanceRecord model).
 *  - locations: only those referenced by the (filtered) week demands → `{id, latLng}`.
 *  - travelMatrix: haversine minutes for every (employee-with-coords × location-with-coords),
 *    skipping any endpoint missing coordinates — identical to the runtime loop.
 *  - weights `{d:1, e:1, g:1}` and `solverConfig` are constants; the seed is FIXED for reproducibility.
 *
 * The whole envelope is validated through `ProblemInputSchema.parse` before returning, exactly as the
 * runtime does, so an unschedulable shape fails loudly here rather than at the optimizer.
 */

/** FROZEN determinism knobs. Matches GrafikService (`seed: 42`, `timeLimit: 10`). */
export const SOLVER_SEED = 42
export const SOLVER_TIME_LIMIT = 10
/** Objective weights, matching GrafikService. */
export const WEIGHTS = { d: 1, e: 1, g: 1 } as const

/** The seven ISO `YYYY-MM-DD` dates of the solve week starting `weekStart` (a Monday). */
function weekDates(weekStart: string): string[] {
  const base = new Date(`${weekStart}T00:00:00.000Z`)
  return Array.from({ length: 7 }, (_, i) =>
    new Date(base.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  )
}

export interface PackOptions {
  /** Restrict demands (and thus locations + travel) to these location ids; omit for the full week. */
  lokalizacjaIds?: string[]
}

/**
 * Build one `ProblemInput` for `weekStart` from the canonical `seed`, optionally scoped to a subset
 * of locations. Throws (via Zod) if the assembled envelope violates the frozen schema.
 */
export function packProblem(seed: CanonicalSeed, weekStart: string, opts: PackOptions = {}): ProblemInput {
  const dates = new Set(weekDates(weekStart))
  const locFilter = opts.lokalizacjaIds ? new Set(opts.lokalizacjaIds) : null

  // demands: week × optional location filter.
  const demandRows = seed.demands.filter(
    (d) => dates.has(d.date) && (locFilter === null || locFilter.has(d.lokalizacjaId)),
  )

  // Per employee, the ISO dates *within this week* covered by any APPROVED leave (closed interval),
  // sorted — the H3 hard block. Mirrors the runtime's leave expansion.
  const leaveByEmployee = new Map<string, Set<string>>()
  for (const lv of seed.leaves) {
    if (lv.status !== 'APPROVED') continue
    for (const date of dates) {
      if (lv.startDate <= date && date <= lv.endDate) {
        let set = leaveByEmployee.get(lv.employeeId)
        if (!set) {
          set = new Set<string>()
          leaveByEmployee.set(lv.employeeId, set)
        }
        set.add(date)
      }
    }
  }

  // locations: those actually referenced by the (filtered) week demands.
  const locIds = [...new Set(demandRows.map((d) => d.lokalizacjaId))]
  const locById = new Map(seed.locations.map((l) => [l.id, l]))
  const locationRows = locIds.map((id) => locById.get(id)).filter((l): l is NonNullable<typeof l> => l != null)

  const demands: DemandInput[] = demandRows.map((d) => ({
    id: d.id,
    locId: d.lokalizacjaId,
    date: d.date,
    start: d.start,
    end: d.end,
    role: d.requiredRole,
    count: d.requiredCount,
  }))
  const employees: EmployeeInput[] = seed.employees.map((e) => ({
    id: e.id,
    qualifications: e.qualifications,
    etat: e.etat,
    homeLatLng: e.homeLat != null && e.homeLng != null ? { lat: e.homeLat, lng: e.homeLng } : null,
    approvedLeaveDates: [...(leaveByEmployee.get(e.id) ?? [])].sort(),
    historyHours: 0, // DATA-GAP parity with the runtime (no AttendanceRecord model)
  }))
  const locations: LocationInput[] = locationRows.map((l) => ({
    id: l.id,
    latLng: l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null,
  }))
  // travelMatrix: haversine minutes, skipping any endpoint without coordinates.
  const travelMatrix: TravelEntry[] = []
  for (const e of seed.employees) {
    if (e.homeLat == null || e.homeLng == null) continue
    const home = { lat: e.homeLat, lng: e.homeLng }
    for (const l of locationRows) {
      if (l.lat == null || l.lng == null) continue
      travelMatrix.push({ employeeId: e.id, locId: l.id, minutes: commuteMinutes(home, { lat: l.lat, lng: l.lng }) })
    }
  }

  return ProblemInputSchema.parse({
    horizon: { weekStart },
    locations,
    employees,
    demands,
    travelMatrix,
    weights: WEIGHTS,
    solverConfig: { seed: SOLVER_SEED, timeLimit: SOLVER_TIME_LIMIT },
  })
}
