import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProblemInputSchema, SolveStatus } from '@hrobot/shared'
import { buildCanonicalSeed } from '@hrobot/db'
import { buildProblemSpecs } from './problems.js'
import type { ColdStartPair } from './dataset.js'

/**
 * Integrity check for the committed cold-start artifact (M2-C1 phase A). Runs WITHOUT the optimizer:
 * it validates the on-disk `coldstart.jsonl` against the frozen contract, checks every teacher label
 * references a real id in its own input, and re-derives each `ProblemInput` from the frozen seed to
 * prove the committed inputs are exactly what the packer produces (so the artifact can't silently
 * drift from the seed). Regenerate the artifact with `pnpm --filter @hrobot/agent coldstart:generate`.
 */

const JSONL_PATH = join(__dirname, '..', 'dataset', 'coldstart.jsonl')

function loadPairs(): ColdStartPair[] {
  const raw = readFileSync(JSONL_PATH, 'utf8').trim()
  return raw.split('\n').map((line) => JSON.parse(line) as ColdStartPair)
}

describe('cold-start dataset integrity', () => {
  const pairs = loadPairs()
  const specs = buildProblemSpecs(buildCanonicalSeed())
  const specById = new Map(specs.map((s) => [s.id, s]))

  it('is non-empty and one JSONL record per generated problem spec', () => {
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs.length).toBe(specs.length)
    expect(new Set(pairs.map((p) => p.id)).size).toBe(pairs.length) // unique ids
    expect(new Set(pairs.map((p) => p.id))).toEqual(new Set(specs.map((s) => s.id)))
  })

  it('every stored ProblemInput re-validates against the FROZEN schema', () => {
    for (const p of pairs) {
      expect(() => ProblemInputSchema.parse(p.input)).not.toThrow()
    }
  })

  it('every stored input matches the packer re-run over the frozen seed (no drift)', () => {
    for (const p of pairs) {
      const spec = specById.get(p.id)
      expect(spec).toBeDefined()
      // Deep-equal the freshly-packed envelope: ties the committed artifact to the canonical seed.
      expect(p.input).toEqual(spec!.input)
      expect(p.meta.weekStart).toBe(spec!.weekStart)
      expect(p.meta.lokalizacjaIds).toEqual(spec!.lokalizacjaIds)
    }
  })

  it('every assignment references an employee id and a demand id present in its input', () => {
    for (const p of pairs) {
      const empIds = new Set(p.input.employees.map((e) => e.id))
      const demandIds = new Set(p.input.demands.map((d) => d.id))
      for (const a of p.assignments) {
        expect(empIds.has(a.employeeId)).toBe(true)
        expect(demandIds.has(a.demandId)).toBe(true)
      }
      // unmet, too, must name a demand that exists in the input.
      for (const u of p.unmet) {
        expect(demandIds.has(u.demandId)).toBe(true)
      }
    }
  })

  it('never over-staffs a demand and never repeats an (employee, demand) pair', () => {
    for (const p of pairs) {
      const countByDemand = new Map(p.input.demands.map((d) => [d.id, d.count]))
      const perDemand = new Map<string, number>()
      const seenPairs = new Set<string>()
      for (const a of p.assignments) {
        const key = `${a.employeeId}|${a.demandId}`
        expect(seenPairs.has(key)).toBe(false)
        seenPairs.add(key)
        perDemand.set(a.demandId, (perDemand.get(a.demandId) ?? 0) + 1)
      }
      for (const [demandId, n] of perDemand) {
        expect(n).toBeLessThanOrEqual(countByDemand.get(demandId)!)
      }
    }
  })

  it('assignments are stored in the deterministic (demandId, employeeId) order', () => {
    for (const p of pairs) {
      const sorted = [...p.assignments].sort((a, b) =>
        a.demandId === b.demandId ? a.employeeId.localeCompare(b.employeeId) : a.demandId.localeCompare(b.demandId),
      )
      expect(p.assignments).toEqual(sorted)
    }
  })

  it('status is a valid enum; OPTIMAL/FEASIBLE ⇒ no unmet, INFEASIBLE ⇒ some unmet', () => {
    const valid = new Set(Object.values(SolveStatus))
    for (const p of pairs) {
      expect(valid.has(p.status)).toBe(true)
      if (p.status === SolveStatus.INFEASIBLE) {
        expect(p.unmet.length).toBeGreaterThan(0)
      } else {
        expect(p.unmet.length).toBe(0)
      }
    }
  })

  it("full-week problems' status matches the canonical week's designed feasibility", () => {
    for (const p of pairs.filter((x) => x.meta.scope === 'full')) {
      if (p.meta.weekExpectFeasible) {
        expect(p.status).not.toBe(SolveStatus.INFEASIBLE)
      } else {
        expect(p.status).toBe(SolveStatus.INFEASIBLE)
      }
    }
  })

  it('has the expected pair count and status distribution', () => {
    const dist = pairs.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1
      return acc
    }, {})
    // 2 canonical weeks × {full + one per Warsaw location} = 6 pairs.
    expect(pairs.length).toBe(6)
    expect(dist).toEqual({ OPTIMAL: 4, INFEASIBLE: 2 })
    // The dataset must carry BOTH outcome classes for cold-start to learn from.
    expect(dist[SolveStatus.OPTIMAL]).toBeGreaterThan(0)
    expect(dist[SolveStatus.INFEASIBLE]).toBeGreaterThan(0)
  })
})
