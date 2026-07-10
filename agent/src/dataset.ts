import { SolveResultSchema, type Assignment, type Metrics, type ProblemInput, type SolveResult, type Unmet } from '@hrobot/shared'

/**
 * On-disk shape of one cold-start imitation pair: a `ProblemInput` and the assignments the CP-SAT
 * "teacher" produced for it. Written one-per-line as JSONL (`coldstart.jsonl`). `input` is the exact
 * frozen envelope; `assignments`/`unmet`/`metrics`/`status` are the teacher's `SolveResult`.
 */
export interface ColdStartPair {
  /** Stable id: `<week>__<scope>` (e.g. `feasible__full`, `infeasible__waw-lotnisko`). */
  id: string
  meta: {
    /** Canonical week label. */
    week: 'feasible' | 'infeasible'
    weekStart: string
    /** Location-id scope for this instance, or null for the whole week. */
    lokalizacjaIds: string[] | null
    /** Human label for the scope (`full` or a single location key). */
    scope: string
    /** The canonical week's designed feasibility (a NECESSARY-coverage expectation, not a promise). */
    weekExpectFeasible: boolean
  }
  status: SolveResult['status']
  input: ProblemInput
  /**
   * Teacher labels — the imitation target, sorted for a stable artifact. On OPTIMAL/FEASIBLE this is a
   * fully-covering schedule (`unmet` empty). On INFEASIBLE it is the optimizer's phase-2, maximal-
   * coverage BEST-EFFORT partial schedule (a fixed-seed OPTIMAL solve of the coverage-relaxed model,
   * so still deterministic) and `unmet` names the slots it could not cover. Downstream training can
   * filter by `status`; nothing is dropped.
   */
  assignments: Assignment[]
  unmet: Unmet[]
  metrics: Metrics
}

/** Deterministic assignment ordering so the committed artifact is byte-stable across solver runs. */
export function sortAssignments(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) =>
    a.demandId === b.demandId ? a.employeeId.localeCompare(b.employeeId) : a.demandId.localeCompare(b.demandId),
  )
}

/** Deterministic unmet ordering, same rationale. */
export function sortUnmet(unmet: Unmet[]): Unmet[] {
  return [...unmet].sort((a, b) => (a.demandId === b.demandId ? a.reason.localeCompare(b.reason) : a.demandId.localeCompare(b.demandId)))
}

/**
 * Minimal HTTP client for the grafik-optimizer `POST /solve`, mirroring the transport in
 * apps/tenant-runtime/src/grafik/optimizer.client.ts (same env var `OPTIMIZER_URL`, same
 * `SolveResultSchema.parse` on the way out). Default differs on purpose: this tool talks to the
 * host-exposed optimizer at `http://localhost:8001`, not the compose service name.
 */
export function optimizerBaseUrl(): string {
  return process.env.OPTIMIZER_URL ?? 'http://localhost:8001'
}

export async function solve(problem: ProblemInput, baseUrl = optimizerBaseUrl()): Promise<SolveResult> {
  const url = `${baseUrl}/solve`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(problem),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`optimizer ${url} returned ${res.status}: ${detail}`)
  }
  return SolveResultSchema.parse(await res.json())
}
