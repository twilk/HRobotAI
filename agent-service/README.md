# agent-service — self-learning scheduling agent (M2-C1 phase B + M2-C2 + **M2-C3**)

> **Honest framing — read this first.** This is the **demonstrable M2 increment** of a self-learning,
> **self-developing** scheduling loop: cold-start **behaviour cloning** + **feedback-driven
> adaptation** + a **formal batch retrain** that regenerates the policy from accumulated feedback,
> versioned with saved training artifacts — all on synthetic data, layered on the FROZEN grafik
> contract and the live CP-SAT optimizer. It makes **no claim** of production autonomy or a
> "4Mobility-ready" model.
>
> **What the mechanism actually is:** an **affinity learner + batch re-fit**. `app/policy.py` and
> `app/retrain.py` import only the standard library. **No reinforcement learning runs anywhere in
> this repo, and no module imports `stable_baselines3`.** Do not describe this service as "SB3" or
> "RL" in demos, decks or the evidence pack — say *affinity-learner + batch re-fit*. Full on-policy
> RL on live data, unsupervised autonomy, multi-branch transfer, and advanced forecasting are the
> **staged path after M2** (spec §8). See
> `docs/superpowers/specs/2026-07-09-m2-p2-agent-ai-grafik-manager-design.md` and
> `data/m2-evidence/known-limitations.md`.

This is a **distinct image** from `grafik-optimizer` on purpose: the heavier offline imitation stack
(`imitation`, plus the `torch`/`stable-baselines3` it is built on) is installed here so
`app/train_bc.py` can run; the CP-SAT image stays lean and is owned by another team. The two
services communicate only over the FROZEN `POST /solve` contract.

| Component | Imports | Used by the API? |
|---|---|---|
| `app/policy.py`, `app/retrain.py` — the affinity learner | stdlib only | **Yes — this is the serving path** |
| `app/env.py` — `GrafikSchedulingEnv` | `gymnasium`, `numpy` | No. A scaffold; no RL algorithm trains against it |
| `app/train_bc.py` — offline BC CLI | `imitation` (→ `torch`/SB3) | No. Trains, but the API never loads its artifact (Q8) |

## Increment history

- **M2-C1 phase B** (merged, PR #20): the Gymnasium + `imitation` skeleton — `python:3.12-slim` image,
  own pydantic contract mirror + parity test, `GrafikSchedulingEnv` (Gymnasium) with weight-0 reward
  seams, the `OptimizerClient` seam, the BC (`imitation`) cold-start entry point, and the `/agent/*`
  501 seams. (Historically called "the SB3 skeleton" — inaccurate: SB3 is never imported.)
- **M2-C2** (merged, PR #22): fills those 501 seams with working handlers, adds the tenant-isolated
  feedback store and the online-learning loop, wires the env's manager-acceptance seam, and ships
  the **AG2 edit-distance-drop demo**. Built *on top of* phase B — the contract mirror, env, parity
  test, and optimizer client are reused, not rebuilt.
- **M2-C3** (this increment): the **self-developing** capability — a **formal batch retrain pipeline**
  (`app/retrain.py`, `python -m app.retrain`, `POST /agent/retrain`) that regenerates the policy from
  the *full accumulated feedback log* + cold-start dataset, emitting **versioned `AgentPolicyVersion`
  records** (spec §6: `id, version, trainedAt, metrics, artefactPath`) each with a **saved training
  artifact**. Ships the **AG5 demo** (`app/demo_ag5.py`): ≥2 policy versions with a **rising acceptance
  metric**, and reinforces **AG2** by showing the edit-distance drop holds when driven by the batch
  pipeline. Built *on top of* M2-C2 — reuses the store, policy, metrics, and the AG2 scenario.

## Why an agent and not just the solver

The CP-SAT solver (#1) has **fixed weights** and solves the problem *as defined*. It cannot learn
that a specific manager/branch has preferences its weights don't encode. This agent learns those
preferences from the manager's **corrections** — that adaptation is the whole point (spec §16), and
it is exactly what the AG2 demo measures.

## What M2-C2 adds

| Capability | M2-C2 endpoint / mechanism |
|---|---|
| **Self-learning** | `POST /agent/feedback` logs manager corrections as reward and re-fits the policy; edit-distance to the manager-accepted schedule **drops** (AG2 — monotonically against the constructed reference, non-monotonically against an independent one; see below). |
| **Reasoning** | `GET /agent/explain` — per-assignment rationale + alternatives considered (AG4). |
| **Self-developing** | Policy is **versioned**; the **formal batch retrain** (`python -m app.retrain` / `POST /agent/retrain`) regenerates it from the accumulated feedback log and writes an `AgentPolicyVersion` (+ saved artifact) per version. `GET /agent/policy` shows `v1→v2→…` with a rising acceptance metric (AG5). |
| **Self-healing** | `POST /agent/heal` validates a proposal and repairs it **through the live solver** (`OptimizerClient`) (AG3). |
| Demand forecast | `POST /agent/forecast` — a simple, honest **weekly-seasonal** model (not a time-series ML stack). |

### The learning policy (and its honest limits)

The M2-C2 serving policy (`app/policy.py`) is a **stdlib-only affinity learner**: behavioural cloning
of the solver teacher, plus an **online affinity update** keyed by `(employee, slot-signature)` where
`slot-signature = (role, locId, date, shiftStart)` — a learned *preference rule*, not memorisation of
a demand id. The spec's risk table explicitly sanctions this minimal viable path ("BC przez imitation
… degradacja do samego BC+forecaster", §112); M2 ships that degraded path, and calling it RL would be
wrong.

**Because the signature contains the date, nothing learned transfers to the next week.** Measured: an
agent trained to edit-distance 0 on week W scores 98 against the same manager on week W+7d — exactly
what an untrained agent scores, with a bit-identical proposal (`demo/hon2_controls.py`, control C3).
Cross-week generalisation is M3 work.

This sits **alongside** the phase-B Gym scaffold, it does not replace it. `GrafikSchedulingEnv` keeps
its `RewardConfig`; M2-C2 **wires its weight-0 `manager_acceptance` seam** (previously declared but
unused) so a feasible assignment that reproduces a manager-kept slot earns reward — the env-side
counterpart of the online feedback signal, and the hook a future RL path could train against. No such
training exists today.

## The AG2 money shot

`app/demo_ag2.py` runs a fixed synthetic scenario (the canonical cold-start problem: 36 employees,
38 demands, 52 assignments). A scripted manager has preferences the fixed-weight solver cannot
encode. Each round: propose → manager corrects the most-mismatched slots (`MOVE` edits) →
`/agent/feedback` → re-fit → re-propose.

**Metric.** `edit_distance = |proposed △ manager_accepted|` — the symmetric difference of
`(employeeId, demandId)` pairs (a reassignment counts as 2). `normalized = edit_distance / (2·|A|)`.

### Scenario 1 — `--manager constructed` (default; read the caveat)

Manager prefers *"hours to full-timers first"*. Run (`python -m app.demo_ag2`):

```
 v1 round 0:  50
 v2 round 1:  44
 v3 round 2:  28
 v4 round 3:  18
 v5 round 4:   4
 v6 round 5:   0   → converged to the manager-accepted schedule
```

> **Caveat you must state out loud (HON-2).** This reference schedule is built by calling the agent's
> **own** `ImitationPolicy.propose` with the manager's preference loaded into affinity. The target is
> therefore drawn from the policy's own hypothesis class — the agent reproduces it *exactly* when you
> hand it the matching affinity table (`demo/hon2_controls.py`, control C1: `edit_distance=0`). It is
> also unusually close to the agent's cold-start bias, which is why it converges in 5 rounds. Quoting
> "50 → 0 in 5 rounds" as proof the agent learns manager preferences overstates what was measured.
>
> The construction is not the *whole* story — pushing a random preference through the same builder
> does **not** converge in 6 rounds (`[102, 90, 76, 70, 82, 54]`, `[80, 70, 58, 50, 46, 34]`,
> `[84, 76, 62, 50, 44, 36]`) — but scenario 2 is the number to quote.

### Scenario 2 — `--manager independent` (the honest one)

`app/manager_profile.py` writes the manager's roster **without ever calling the agent's policy**:
scarcity-first demand order, a load-dependent "least-loaded wins" rule, a weekly shift cap, and a
taste for who works mornings vs afternoons derived from a SHA-256 digest — uncorrelated with every
feature the agent scores on. The target is still hard-feasible (0 violations, 52/52 coverage), so the
comparison is fair. `tests/test_ag2_independent.py` fails if that reference ever calls `propose()`.

Run (`python -m app.demo_ag2 --manager independent`):

```
 round  0:  96      round  5:  52      round 10:  34      round 15:  16
 round  1:  76      round  6:  50      round 11:  36      round 16:  10
 round  2:  62      round  7:  52      round 12:  28      round 17:   0  → converged
 round  3:  70      round  8:  44      round 13:  26
 round  4:  60      round  9:  40      round 14:  20
```

| | constructed | independent |
|---|---|---|
| day-1 edit-distance (of 104) | 50 | **96** |
| day-1 agreement with the manager | 51.9% | **7.7%** |
| first round at 0 (budget 6) | 5 | **17** |
| monotone non-increasing | yes | **no** (62→70, 50→52, 34→36) |
| ablation `--no-feedback` | flat at 50 | flat at 96 |

**The agent does converge to an independently defined preference** — that is a genuine positive
result, and it holds for six different arbitrary managers (day-1 96–100, zero at rounds 14–17; see
`evidence/hon2_controls_run.txt`). It just takes ~3× the feedback and the curve is not monotone.

The drop is **real** in both scenarios: `--no-feedback` disables learning and the curve stays
perfectly flat. Artifacts land in `evidence/` — `ag2_result.json` / `ag2_editdistance.csv` /
`ag2_chart.svg` for scenario 1, `ag2_independent_*` for scenario 2, and `hon2_controls_run.txt` for
the three controls (`python -m demo.hon2_controls`).

## M2-C3: the formal retrain pipeline (self-development)

### Online nudge vs. batch retrain — two *distinct* learning paths

| | **Online nudge** (`app/policy.py`, M2-C2) | **Batch retrain** (`app/retrain.py`, M2-C3) |
|---|---|---|
| Trigger | every `POST /agent/feedback` call | `python -m app.retrain` / `POST /agent/retrain` |
| Starting point | the *current persisted* affinity table | a **fresh** `PolicyState` (affinity discarded) |
| Data | the *one* correction just received | the **full accumulated feedback log** + cold-start dataset |
| Nature | incremental, **path-dependent** (order matters) | from-scratch re-fit — a **deterministic function** of the dataset |
| Output | a bumped version, no artifact | a new `AgentPolicyVersion` with a **saved training artifact** |

The batch retrain is the "self-developing" step: imitation (BC on the cold-start teacher) →
feedback-augmented re-fit from the whole history. Because it re-derives the policy from the entire
log each time, successive retrains over a growing log yield **monotonically better** policies.

### AG5 evidence (`python -m app.demo_ag5`, or `python -m app.retrain`)

Reuses the AG2 scenario (same scripted manager, same `_edits_toward` corrections — imported from
`demo_ag2`, not forked) but drives learning **only through the batch pipeline**: each round appends
the manager's corrections to the log (no online learning), then runs a batch retrain. Representative:

```
 v1 cold-start-bc  acc=0.519 dist= 50 fb=  0   (cold-start)
 v2 batch-retrain  acc=0.577 dist= 44 fb=  8   policy_ag5-demo_v2.json
 v3 batch-retrain  acc=0.731 dist= 28 fb= 15   policy_ag5-demo_v3.json
 v4 batch-retrain  acc=0.827 dist= 18 fb= 21   policy_ag5-demo_v4.json
 v5 batch-retrain  acc=0.962 dist=  4 fb= 27   policy_ag5-demo_v5.json
 v6 batch-retrain  acc=1.000 dist=  0 fb= 29   policy_ag5-demo_v6.json
```

**AG5**: ≥2 versions, acceptance **rises** `0.52 → 1.00`, each with a saved artifact. **AG2 (via the
pipeline)**: edit-distance **drops** `50 → 0` — the same result as the online loop, now proven under
the batch retrain. Evidence lands in `evidence/` (`ag5_result.json`, `ag5_acceptance.csv`,
`ag5_chart.svg`) plus the per-version training artifacts committed under `evidence/ag5_artifacts/`.

**Training artifacts.** Each retrain saves the fitted policy (`policy_<tenant>_v<n>.json`: version +
affinity table + metrics) to `artefactPath`. The runtime dir is `AGENT_DB_PATH`-adjacent
(`AGENT_ARTIFACTS_DIR`-overridable) and **gitignored**; `RetrainPipeline.load_artifact()` round-trips
it back into a `PolicyState`. Tenant-keyed like everything else (AG6).

## API (spec §5)

```
POST /agent/propose   { problemInputId | problem, tenantId? }     → { proposalId, assignments[], rationale[], policyVersion, feasibility }
POST /agent/feedback  { proposalId, edits[], accepted, tenantId? } → { ok, rewardLogged, policyVersion }
POST /agent/heal      { infeasibleProposal:{ problem|problemInputId, assignments[] } } → { repairedAssignments[], whatWasWrong[], solverStatus, unmet[] }
GET  /agent/explain   ?proposalId=&demandId=&tenantId=            → { rationale, alternativesConsidered[] }
POST /agent/forecast  { locationId, horizon }                     → { predictedDemand[] }
POST /agent/retrain   { tenantId?, note? }                        → { id, version, metrics, artefactPath, acceptanceMetric }
GET  /agent/policy    ?tenantId=                                  → { version, trainedAt, acceptanceMetric, latestArtefactPath, trainingRuns[], feedbackCount }
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
| `AGENT_ARTIFACTS_DIR` | `<AGENT_DB_PATH dir>/artifacts` | Where the batch retrain saves per-version policy artifacts (gitignored). |

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

# M2-C3 batch retrain / AG5 self-development demo — >=2 rising versions + saved artifacts (writes evidence/)
docker.exe exec agent-smoke python -m app.retrain           # == python -m app.demo_ag5
docker.exe exec agent-smoke python -m app.retrain --once --tenant demo-tenant   # single live-store retrain

# Cold-start BC (phase-B entry point, imitation lib)
docker.exe exec agent-smoke python -m app.train_bc --dataset data/coldstart_sample.jsonl --epochs 1

# Tests — the parity test needs the frozen contract, which is OUTSIDE the build context, so copy it in:
docker.exe exec agent-smoke mkdir -p /ref
docker.exe cp ./grafik-optimizer/app/contract.py agent-smoke:/ref/contract.py
docker.exe exec -e OPTIMIZER_CONTRACT_PATH=/ref/contract.py agent-smoke python -m pytest -q
```

## J4 live demo (UAT in front of 4Mobility)

Makes the self-learning loop **live-demoable** — brings the agent up alongside the running stack and
drives it, through the **live** optimizer, so a stakeholder *watches* the agent learn instead of
reading committed metrics. Everything is the fixed synthetic scenario (RODO-safe). Scripts live in
`demo/` (host-side; not shipped into the image).

**1 — bring it up (standalone, joined to the live stack net — NOT via compose):**

```bash
bash agent-service/demo/up.sh        # builds agent-service:demo, runs it on host :8010,
                                     # joined to `hrobot_default`, OPTIMIZER_URL=http://optimizer:8000
curl http://localhost:8010/health    # -> {"status":"ok"}
bash agent-service/demo/down.sh      # stop + remove
```

`up.sh` does **not** edit `docker-compose.yml` (owned by another team). The reserved compose `agent`
slot is the alternative "in-stack" wiring — that needs an **sm-grafik-core PR** to `docker-compose.yml`
and is a **documented follow-up**, out of scope here.

**2 — run the scripted demo (drives the running agent → live optimizer):**

```bash
AGENT_DEMO_PASSWORD=… python3 agent-service/demo/j4_live_demo.py --base http://localhost:8010 --user demo
# …or with a token you already hold:
AGENT_TOKEN=eyJ… python3 agent-service/demo/j4_live_demo.py --base http://localhost:8010
```

Pure-stdlib (`urllib`) client — runs on any host `python3`, no install. It walks the audience through:
`heal` (proves the **live** solver answers) → `propose` (schedule **+ per-assignment rationale**) →
`feedback` (scripted manager corrections) → `retrain` (batch self-development, new versioned policy +
artifact) → re-propose, printing the **edit-distance drop `50 → 0`** live. Representative run captured
in `demo/evidence/j4_live_demo_run.txt`.

**Auth — there is no `--tenant` flag.** Every `/agent/*` route (including `/agent/demo/corrections`)
requires a Keycloak bearer token and derives the tenant from the token's issuer realm, never from a
`tenantId` in the request body (AG6 tenant isolation — see `app/deps.py`). The client mints its token
with the same password grant the rest of the stack uses (`client_id=hrobot-web`), so **the realm you
authenticate against *is* the tenant**. Because that tenant is fixed rather than fresh per run, the
demo opens with `POST /agent/reset` to put it back at cold-start — that is what keeps every run showing
the full `50 → 0` climb (`--keep-training` skips it).

**Bonus — a self-served visual page** (optional stretch, genuinely working — not a mock):

```
http://localhost:8010/agent/demo
```

Same-origin vanilla-JS page (served by `app/demo_router.py`, no CDN/CORS) that runs the same loop with
a live table + the edit-distance number falling to 0. Paste an access token into the field at the top —
the page sends it as `Authorization: Bearer` on every call and builds no `tenantId` into any body, so
the token's realm alone decides whose rosters it can read. Screenshot: `demo/evidence/j4_demo_page.png`.

**Reset & replay (always shows the full climb from a FRESH agent).** The page's primary button —
*"Reset demo agent to cold-start & replay"* — first calls `POST /agent/reset` then drives the loop, so
UAT always sees the whole climb (**edit-distance `50 → 0`** AND **agreement `52% → 100%`**) from an
untrained agent, deterministically every run. `POST /agent/reset` (tenant from the bearer token) is
**tenant-scoped** (never a blanket wipe): it clears that tenant's `agent_feedback`, `policy_versions`
and `policy_state` (via `AgentStore.reset_tenant`) and re-derives the day-1 cold-start BC baseline
through the *existing* `AgentService._load_policy` cold start — no parallel policy. It is deterministic
and idempotent. Honest framing: a **demo affordance** to replay the M2 learning loop, not production
reset semantics. Guarded by `tests/test_reset.py`. Evidence: `demo/evidence/reset_replay_run.txt`,
`demo/evidence/j4_reset_replay_page.png`.

The scripted manager stays **server-side and reused** (`/agent/demo/corrections` calls the committed
`demo_ag2` helpers) so the client is thin. Guarded by `tests/test_demo_router.py`; its auth boundary
(401 without a token, and tenant-A-token + tenant-B-body cannot read B) by `tests/test_demo_router_auth.py`.

## Consuming the FROZEN contract (mirror + parity)

`ProblemInput`/`SolveResult` is **FROZEN**; canonical source `packages/shared/src/grafik/contract.ts`
(Zod), mirrored in `grafik-optimizer/app/contract.py` (pydantic). agent-service keeps its **own**
mirror at `app/contract.py` and a **parity test** (`tests/test_contract_parity.py`) that loads the
optimizer's mirror by path and asserts field-for-field + enum equality. We never edit or import
across the boundary; the test holds the line.
