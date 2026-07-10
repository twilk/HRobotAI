/* eslint-disable no-console -- this is a CLI generator; console is its progress + result output. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCanonicalInvariants, buildCanonicalSeed } from '@hrobot/db'
import { SolveStatus } from '@hrobot/shared'
import { buildProblemSpecs } from './problems.js'
import { SOLVER_SEED, WEIGHTS } from './pack.js'
import { optimizerBaseUrl, solve, sortAssignments, sortUnmet, type ColdStartPair } from './dataset.js'

/**
 * M2-C1 phase A — cold-start imitation dataset generator.
 *
 * Reproducibly turns the FROZEN canonical synthetic seed (packages/db/src/seed) into
 * `(ProblemInput -> assignments)` pairs, using the LIVE grafik-optimizer `POST /solve` as the CP-SAT
 * "teacher". No DB connection and no PII: everything is derived from the pure in-repo seed (RODO:
 * synthetic only). Output is JSONL + a meta summary under `agent/dataset/`.
 *
 * Run: `pnpm --filter @hrobot/agent coldstart:generate` (optimizer default `http://localhost:8001`,
 * override with `OPTIMIZER_URL`). See agent/README.md.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const DATASET_DIR = join(HERE, '..', 'dataset')
const JSONL_PATH = join(DATASET_DIR, 'coldstart.jsonl')
const META_PATH = join(DATASET_DIR, 'coldstart.meta.json')

async function main(): Promise<void> {
  const baseUrl = optimizerBaseUrl()

  // Fail fast + friendly if the optimizer isn't up.
  try {
    const health = await fetch(`${baseUrl}/health`)
    if (!health.ok) throw new Error(`/health -> ${health.status}`)
  } catch (err) {
    console.error(
      `[coldstart] grafik-optimizer not reachable at ${baseUrl} (${String(err)}).\n` +
        `Start it, or point OPTIMIZER_URL at a running instance. See agent/README.md.`,
    )
    process.exitCode = 1
    return
  }

  const seed = buildCanonicalSeed()
  assertCanonicalInvariants(seed) // fail loud if the frozen seed drifted
  const specs = buildProblemSpecs(seed)

  console.log(`[coldstart] optimizer=${baseUrl}  problems=${specs.length}`)

  const pairs: ColdStartPair[] = []
  for (const spec of specs) {
    const result = await solve(spec.input, baseUrl)
    pairs.push({
      id: spec.id,
      meta: {
        week: spec.week,
        weekStart: spec.weekStart,
        lokalizacjaIds: spec.lokalizacjaIds,
        scope: spec.scope,
        weekExpectFeasible: spec.weekExpectFeasible,
      },
      status: result.status,
      input: spec.input,
      assignments: sortAssignments(result.assignments),
      unmet: sortUnmet(result.unmet),
      metrics: result.metrics,
    })
    const flag = result.status === SolveStatus.INFEASIBLE ? ' [flagged: best-effort partial coverage]' : ''
    console.log(
      `[coldstart]  ${spec.id.padEnd(28)} ${result.status.padEnd(10)} ` +
        `assignments=${result.assignments.length} unmet=${result.unmet.length}${flag}`,
    )
  }

  const statusDistribution = pairs.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1
    return acc
  }, {})

  mkdirSync(DATASET_DIR, { recursive: true })
  const jsonl = pairs.map((p) => JSON.stringify(p)).join('\n') + '\n'
  writeFileSync(JSONL_PATH, jsonl)

  const meta = {
    milestone: 'M2-C1 phase A (cold-start imitation dataset)',
    source: 'packages/db/src/seed/canonicalData.ts (frozen canonical synthetic seed)',
    optimizer: { defaultUrl: 'http://localhost:8001', envVar: 'OPTIMIZER_URL', endpoint: 'POST /solve' },
    solver: { seed: SOLVER_SEED, weights: WEIGHTS, note: 'ProblemInput.solverConfig.seed is fixed for reproducibility' },
    pairCount: pairs.length,
    statusDistribution,
    pairs: pairs.map((p) => ({
      id: p.id,
      status: p.status,
      week: p.meta.week,
      scope: p.meta.scope,
      demands: p.input.demands.length,
      employees: p.input.employees.length,
      assignments: p.assignments.length,
      unmet: p.unmet.length,
    })),
  }
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n')

  console.log(
    `[coldstart] wrote ${pairs.length} pairs -> ${JSONL_PATH}\n` +
      `[coldstart] status distribution: ${JSON.stringify(statusDistribution)}`,
  )
}

main().catch((err) => {
  console.error('[coldstart] generation failed:', err)
  process.exitCode = 1
})
