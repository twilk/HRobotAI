# `@hrobot/agent` — self-learning scheduling agent

**Status: M2-C1 _phase A_ — the cold-start imitation dataset only.**

This module is the home of project point (b), the self-learning scheduling agent. **Phase A** (this
directory today) delivers the *cold-start imitation dataset*: `(ProblemInput → assignments)` pairs
where the assignments come from the existing CP-SAT solver acting as the baseline **teacher**. A later,
separate task builds the SB3 agent service, the Gym environment, the `/agent/*` FastAPI endpoints and
the retrain pipeline on a Python 3.12 + SB3 runtime — **none of that is built here.**

## What phase A produces

A reproducible Node generator that:

1. Sources synthetic inputs from the **frozen canonical seed** in
   [`packages/db/src/seed/canonicalData.ts`](../packages/db/src/seed/canonicalData.ts) — the same
   pure dataset that seeds the tenant DB, so **no database connection is needed** (RODO: synthetic
   data only).
2. Packs them into valid `ProblemInput` envelopes the exact way `POST /grafik/solve` does
   ([`grafik.service.ts`](../apps/tenant-runtime/src/grafik/grafik.service.ts)) — same field mapping,
   the same haversine `travelMatrix` (reused, not reimplemented — see `src/reuse/haversine.ts`), a
   fixed `solverConfig.seed = 42`, and a final `ProblemInputSchema.parse(...)`.
3. Calls the **live grafik-optimizer** `POST /solve` for each problem to get the teacher's
   `SolveResult`, and emits the pairs as JSONL.

The frozen contract (`packages/shared/src/grafik/contract.ts` /
`grafik-optimizer/app/contract.py`), the `grafik-optimizer/` service, and `docker-compose.yml` are
**consumed, never modified**.

## Where the dataset lives

| File | What |
| --- | --- |
| `dataset/coldstart.jsonl` | one `ColdStartPair` (see `src/dataset.ts`) per line — the committed artifact |
| `dataset/coldstart.meta.json` | summary: pair count, status distribution, solver seed/weights, per-pair stats |

At 6 pairs / ~130 KB the full artifact is committed directly (no sampling needed).

### Problem set

The canonical seed has two demonstration weeks (one designed feasible, one designed infeasible). To
give the dataset useful variety **without inventing data**, we enumerate the same scoping the runtime
already supports via its solve DTO (`lokalizacjaIds`): for each week, the **full** problem plus one
problem per Warsaw location it touches. That yields 6 pairs with a real mix of teacher outcomes
(`{OPTIMAL: 4, INFEASIBLE: 2}`).

On `INFEASIBLE`, the pair is **flagged, not dropped**: `status = INFEASIBLE`, `unmet[]` names the
uncovered slots, and `assignments` holds the optimizer's phase-2 **maximal-coverage best-effort**
schedule (a fixed-seed solve of the coverage-relaxed model, so still deterministic). Downstream
training can filter by `status`.

## Running the generator

The optimizer must be up. It currently runs at `http://localhost:8001` (`/health` → `{"status":"ok"}`).

```bash
# from the repo root — builds workspace deps first, then runs the tsx generator
pnpm --filter @hrobot/agent coldstart:generate
```

- **Optimizer URL** is configurable via the `OPTIMIZER_URL` env var (same var name as
  `apps/tenant-runtime/src/grafik/optimizer.client.ts`), **defaulting to `http://localhost:8001`**:

  ```bash
  OPTIMIZER_URL=http://localhost:8001 pnpm --filter @hrobot/agent coldstart:generate
  ```

Output is deterministic: re-running against the live optimizer reproduces `coldstart.jsonl`
byte-for-byte (fixed seed + `num_search_workers=1`; assignments/unmet are sorted before writing).

## Integrity test

`src/coldstart.integrity.test.ts` runs **without the optimizer** and asserts the committed artifact:
every stored `ProblemInput` re-validates against the frozen schema; every `input` equals the packer
re-run over the frozen seed (no drift); every assignment/unmet references an id present in its own
input; no demand is over-staffed and no `(employee, demand)` pair repeats; assignments are in the
deterministic order; and the pair count + status distribution match.

```bash
pnpm --filter @hrobot/agent test        # jest
pnpm --filter @hrobot/agent build       # tsc --noEmit type-check
```

## Out of scope (separate, currently-blocked task)

The Python/SB3 agent service, the Gym env, the `/agent/*` endpoints and the retrain pipeline. Those
need a Python 3.12 + SB3 container runtime not available in this environment and are handled
separately. This module delivers only the phase-A cold-start dataset + its reproducible generator.
