# agent-service — self-learning scheduling agent (M2-C1 phase B + **M2-C2**)

> **Honest framing — read this first.** This is the **demonstrable M2 increment** of a self-learning
> scheduling loop: cold-start **behaviour cloning** + **feedback-driven adaptation** on synthetic
> data, layered on the FROZEN grafik contract and the live CP-SAT optimizer. It is **NOT** the
> finished long-horizon production RL brain, and makes **no claim** of production autonomy or a
> "4Mobility-ready" model. Full on-policy RL on live data, unsupervised autonomy, multi-branch
> transfer, and advanced forecasting are the **staged path after M2** (spec §8). What ships is a
> *working loop you can measure* — not a finished product. See
> `docs/superpowers/specs/2026-07-09-m2-p2-agent-ai-grafik-manager-design.md`.

This is a **distinct image** from `grafik-optimizer` on purpose: the heavy RL stack
(`torch`/`stable-baselines3`/`imitation`) lives here; the CP-SAT image stays lean and is owned by
another team. The two services communicate only over the FROZEN `POST /solve` contract.

## Increment history

- **M2-C1 phase B** (merged, PR #20): the SB3 skeleton — `python:3.12-slim` image, own pydantic
  contract mirror + parity test, `GrafikSchedulingEnv` (Gymnasium) with weight-0 reward seams, the
  `OptimizerClient` seam, the BC (`imitation`) cold-start entry point, and the `/agent/*` 501 seams.
- **M2-C2** (this increment): fills those 501 seams with working handlers, adds the tenant-isolated
  feedback store and the online-learning loop, wires the env's manager-acceptance seam, and ships
  the **AG2 edit-distance-drop demo**. Built *on top of* phase B — the contract mirror, env, parity
  test, and optimizer client are reused, not rebuilt.

## Why an agent and not just the solver

The CP-SAT solver (#1) has **fixed weights** and solves the problem *as defined*. It cannot learn
that a specific manager/branch has preferences its weights don't encode. This agent learns those
preferences from the manager's **corrections** — that adaptation is the whole point (spec §16), and
it is exactly what the AG2 demo measures.

## What M2-C2 adds

| Capability | M2-C2 endpoint / mechanism |
|---|---|
| **Self-learning** | `POST /agent/feedback` logs manager corrections as reward and re-fits the policy; edit-distance to the manager-accepted schedule **drops monotonically** (AG2). |
| **Reasoning** | `GET /agent/explain` — per-assignment rationale + alternatives considered (AG4). |
| **Self-developing** | Policy is **versioned**; `GET /agent/policy` shows `v1→v2→…` with a rising acceptance metric (AG5). |
| **Self-healing** | `POST /agent/heal` validates a proposal and repairs it **through the live solver** (`OptimizerClient`) (AG3). |
| Demand forecast | `POST /agent/forecast` — a simple, honest **weekly-seasonal** model (not a time-series ML stack). |

### The learning policy (and its honest limits)

The M2-C2 serving policy (`app/policy.py`) is a dependency-light numpy **imitation** learner:
behavioural cloning of the solver teacher, plus an **online affinity update** keyed by
`(employee, slot-signature)` where `slot-signature = (role, locId, date, shiftStart)` — a learned
*preference rule*, not memorisation of a demand id. The spec's risk table explicitly sanctions this
minimal viable path ("BC przez imitation … degradacja do samego BC+forecaster", §112).

This sits **alongside** the phase-B RL scaffold, it does not replace it. `GrafikSchedulingEnv` keeps
its `RewardConfig`; M2-C2 **wires its weight-0 `manager_acceptance` seam** (previously declared but
unused) so a feasible assignment that reproduces a manager-kept slot earns reward — the env-side
counterpart of the online feedback signal, and the hook the staged SB3/RL path will train against.

## The AG2 money shot

`app/demo_ag2.py` runs a fixed synthetic scenario (the canonical cold-start problem: 36 employees,
38 demands). A scripted manager prefers *"hours to full-timers first"* — a preference the fixed-weight
solver cannot encode. Each round: propose → manager corrects the most-mismatched slots (`MOVE` edits)
→ `/agent/feedback` → re-fit → re-propose.

**Metric.** `edit_distance = |proposed △ manager_accepted|` — the symmetric difference of
`(employeeId, demandId)` pairs (a reassignment counts as 2). `normalized = edit_distance / (2·|A|)`.

Representative run (`python -m app.demo_ag2`):

```
 v1 round 0:  50
 v2 round 1:  44
 v3 round 2:  28
 v4 round 3:  18
 v5 round 4:   4
 v6 round 5:   0   → converged to the manager-accepted schedule
```

The drop is **real**: `python -m app.demo_ag2 --no-feedback` disables learning and the curve stays
**flat at 50** — the improvement comes only from feedback the policy incorporated. Artifacts land in
`evidence/` (`ag2_result.json`, `ag2_editdistance.csv`, `ag2_chart.svg`) for the M2 evidence pack.

## API (spec §5)

```
POST /agent/propose   { problemInputId | problem, tenantId? }     → { proposalId, assignments[], rationale[], policyVersion, feasibility }
POST /agent/feedback  { proposalId, edits[], accepted, tenantId? } → { ok, rewardLogged, policyVersion }
POST /agent/heal      { infeasibleProposal:{ problem|problemInputId, assignments[] } } → { repairedAssignments[], whatWasWrong[], solverStatus, unmet[] }
GET  /agent/explain   ?proposalId=&demandId=&tenantId=            → { rationale, alternativesConsidered[] }
POST /agent/forecast  { locationId, horizon }                     → { predictedDemand[] }
GET  /agent/policy    ?tenantId=                                  → { version, trainedAt, acceptanceMetric, trainingRuns[], feedbackCount }
```

Edit types: `MOVE {demandId, fromEmployeeId, toEmployeeId}`, `SWAP {demandId, employeeId, otherDemandId, otherEmployeeId}`,
`REMOVE {demandId, employeeId}`, `ACCEPT {demandId, employeeId}`, `REJECT {demandId, employeeId?}`.

## Feedback store & tenant isolation (AG6)

Feedback + policy persist in a **tenant-keyed SQLite** store owned inside `agent-service/`
(`app/store.py`, `AGENT_DB_PATH`-configurable); every read is filtered by `tenantId`, so one
tenant's feedback and policy are never visible to another. **Staged path:** spec §6 puts
`AgentFeedback` in the tenant **Prisma schema** — that production home is **deferred** to a
separately-owned change (it edits `packages/db/prisma/**`, out of scope here). This store is a
drop-in for a Prisma-backed repository later; the router only talks to the `AgentStore` interface.

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `OPTIMIZER_URL` | `http://localhost:8001` | Live optimizer base URL. Inside the `hrobot_default` compose net use `http://optimizer:8000`. |
| `OPTIMIZER_CONTRACT_PATH` | `../grafik-optimizer/app/contract.py` | Where the parity test reads the frozen contract (copy/mount it in for in-container runs). |
| `AGENT_DB_PATH` | `/data/agent.db` | Tenant-isolated feedback/policy SQLite file. |

## Build & run with `docker.exe`

```bash
# Build (context is ./agent-service)
docker.exe build -t agent-service:m2c2 ./agent-service

# Serve (join the compose net so /agent/heal reaches the live solver alias `optimizer`)
docker.exe run -d --name agent-smoke --network hrobot_default \
  -e OPTIMIZER_URL=http://optimizer:8000 -p 8010:8000 agent-service:m2c2
curl http://localhost:8010/health           # -> {"status":"ok"}

# AG2 learning-loop demo (writes evidence/)
docker.exe exec agent-smoke python -m app.demo_ag2

# Cold-start BC (phase-B entry point, imitation lib)
docker.exe exec agent-smoke python -m app.train_bc --dataset data/coldstart_sample.jsonl --epochs 1

# Tests — the parity test needs the frozen contract, which is OUTSIDE the build context, so copy it in:
docker.exe exec agent-smoke mkdir -p /ref
docker.exe cp ./grafik-optimizer/app/contract.py agent-smoke:/ref/contract.py
docker.exe exec -e OPTIMIZER_CONTRACT_PATH=/ref/contract.py agent-smoke python -m pytest -q
```

## Consuming the FROZEN contract (mirror + parity)

`ProblemInput`/`SolveResult` is **FROZEN**; canonical source `packages/shared/src/grafik/contract.ts`
(Zod), mirrored in `grafik-optimizer/app/contract.py` (pydantic). agent-service keeps its **own**
mirror at `app/contract.py` and a **parity test** (`tests/test_contract_parity.py`) that loads the
optimizer's mirror by path and asserts field-for-field + enum equality. We never edit or import
across the boundary; the test holds the line.
