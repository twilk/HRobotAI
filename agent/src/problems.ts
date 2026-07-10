import { CANONICAL_WEEKS, type CanonicalSeed } from '@hrobot/db'
import { packProblem } from './pack.js'
import type { ProblemInput } from '@hrobot/shared'

/**
 * The deterministic list of cold-start problem instances derived from the canonical seed.
 *
 * The canonical dataset has exactly two demonstration weeks (one designed feasible, one designed
 * infeasible; see `CANONICAL_WEEKS`). To give the imitation dataset useful variety WITHOUT inventing
 * any data, we enumerate the same scoping `POST /grafik/solve` already supports via its DTO
 * (`lokalizacjaIds`): for each week we emit the FULL problem plus one problem per distinct location the
 * week touches. Every instance is a legitimate envelope the runtime could pack over the same rows.
 *
 * This yields a mix of statuses the teacher must label (feasible fulls, an infeasible full where the
 * KOORDYNATOR spike bites, and single-location slices some of which are feasible) — exactly the kind
 * of spread cold-start behavioural cloning wants.
 */

export interface ProblemSpec {
  id: string
  week: 'feasible' | 'infeasible'
  weekStart: string
  weekExpectFeasible: boolean
  /** null = whole week; otherwise the single-location scope. */
  lokalizacjaIds: string[] | null
  scope: string
  input: ProblemInput
}

/** ISO dates of the solve week (a Monday + 6). */
function weekDates(weekStart: string): Set<string> {
  const base = new Date(`${weekStart}T00:00:00.000Z`)
  return new Set(Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 86_400_000).toISOString().slice(0, 10)))
}

export function buildProblemSpecs(seed: CanonicalSeed): ProblemSpec[] {
  const locName = new Map(seed.locations.map((l) => [l.id, l.name]))
  const weeks = [
    { key: 'feasible' as const, ...CANONICAL_WEEKS.feasible },
    { key: 'infeasible' as const, ...CANONICAL_WEEKS.infeasible },
  ]

  const specs: ProblemSpec[] = []
  for (const w of weeks) {
    const dates = weekDates(w.weekStart)
    const weekDemands = seed.demands.filter((d) => dates.has(d.date))
    const locIds = [...new Set(weekDemands.map((d) => d.lokalizacjaId))].sort()

    // FULL week.
    specs.push({
      id: `${w.key}__full`,
      week: w.key,
      weekStart: w.weekStart,
      weekExpectFeasible: w.expectFeasible,
      lokalizacjaIds: null,
      scope: 'full',
      input: packProblem(seed, w.weekStart),
    })

    // One problem per location the week touches (only when the week spans >1 location — otherwise the
    // single-location slice would duplicate the full problem).
    if (locIds.length > 1) {
      for (const locId of locIds) {
        const label = locName.get(locId) ?? locId
        specs.push({
          id: `${w.key}__${locId}`,
          week: w.key,
          weekStart: w.weekStart,
          weekExpectFeasible: w.expectFeasible,
          lokalizacjaIds: [locId],
          scope: label,
          input: packProblem(seed, w.weekStart, { lokalizacjaIds: [locId] }),
        })
      }
    }
  }
  return specs
}
