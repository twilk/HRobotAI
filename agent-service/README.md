# agent-service — self-learning scheduling agent (M2-C1, phase B)

> **Framing — read this first.** This is the **first demonstrable increment** of a self-learning
> scheduling agent: a cold-start **behavior-cloning** entry point plus a working **Gymnasium/RL
> loop** layered on the FROZEN grafik contract and the live CP-SAT optimizer. It is **not** a
> finished production RL brain, and it does not act autonomously on real schedules. No overclaiming:
> what ships here is a *skeleton that builds, runs, and trains on a tiny sample* — the learning
> policy and the serving endpoints come in later increments (M2-C2 / M2-C3).

This is a **distinct image** from `grafik-optimizer` on purpose. The heavy RL stack
(`torch`/`stable-baselines3`/`imitation`) lives here; the CP-SAT optimizer image stays lean and is
owned by another team. The two services communicate only over the FROZEN `POST /solve` contract.

## What's in scope for M2-C1 phase B (this task)

| Area | Delivered here |
| --- | --- |
| Image | `python:3.12-slim` + pinned RL/ML deps (`requirements.txt`). CPU-only torch. |
| Contract | Own pydantic mirror (`app/contract.py`) + **parity test** vs the frozen optimizer contract. |
| Gym env | `app/env.py` — `gymnasium.Env` over a `ProblemInput`; tabular obs; assign-employee-to-slot action; feasibility reward with a **live-optimizer seam**. |
| API scaffold | `app/main.py` — `GET /health`; `/agent/*` mounted as a documented **501 seam**. |
| Cold-start BC | `app/train_bc.py` — behavior cloning via `imitation` over a configurable dataset. |
| Sample data | `data/coldstart_sample.jsonl` — tiny synthetic smoke sample (RODO: no PII). |

## Deferred (do NOT expect it here)

- **M2-C2 (serving):** real `/agent/propose|feedback|heal|explain|forecast` handlers, the
  propose→`/solve`→repair **self-heal** loop, policy loading. The router seam
  (`app/agent_router.py`) fixes the surface now and returns `501` until then.
- **M2-C3 (RL):** training an actual policy with the reward loop; manager-acceptance / soft-goal
  reward terms (present as **weight-0 seams** in `RewardConfig`).
- **The real cold-start dataset:** produced by the parallel task that owns `agent/`. This task
  ships only a tiny synthetic sample; point `train_bc.py` at the real dataset with `--dataset`.

## Layout

```
agent-service/
├── Dockerfile                 # distinct RL image (python:3.12-slim + torch/SB3/imitation)
├── requirements.txt           # single source of dep truth (pinned)
├── .dockerignore              # excludes **/CLAUDE.md (WSL symlink gotcha) + host artifacts
├── pyproject.toml             # pytest pythonpath config
├── app/
│   ├── contract.py            # OWN pydantic mirror of the FROZEN ProblemInput/SolveResult
│   ├── env.py                 # GrafikSchedulingEnv (gymnasium.Env) + RewardConfig
│   ├── optimizer_client.py    # seam to live optimizer POST /solve (OPTIMIZER_URL)
│   ├── main.py                # FastAPI: GET /health + /agent/* router seam
│   ├── agent_router.py        # /agent/* → 501 (implemented in M2-C2)
│   ├── train_bc.py            # cold-start behavior cloning entry point
│   ├── rollout.py             # runnable random-action rollout (env smoke)
│   └── sample.py              # tiny synthetic ProblemInput fixture
├── data/
│   ├── coldstart_sample.jsonl # tiny synthetic BC dataset
│   └── README.md              # dataset format (lines up with the parallel task)
└── tests/
    ├── test_contract_parity.py  # mirror == frozen optimizer contract, field-for-field
    ├── test_env.py              # random rollout + reward reflects hard constraints
    └── test_health.py           # /health + /agent seam returns 501
```

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `OPTIMIZER_URL` | `http://localhost:8001` | Base URL of the live grafik-optimizer (`POST /solve`) the env's feasibility seam calls. From inside a container, use `http://host.docker.internal:8001` or the compose service name. |
| `OPTIMIZER_CONTRACT_PATH` | `../grafik-optimizer/app/contract.py` | Where the parity test reads the frozen optimizer contract (mount/copy it in for in-container runs). |
| BC dataset path | `data/coldstart_sample.jsonl` | Configured via `--dataset` on `train_bc.py` (not an env var). |

## Build & run with `docker.exe`

> On this machine, use **`docker.exe`** (the Windows binary on PATH) — it talks to the same Docker
> Desktop daemon running the HRobot stack. `.dockerignore` excludes `**/CLAUDE.md` because
> `docker.exe` chokes on this repo's WSL symlinks.

```bash
# Build (context is ./agent-service)
docker.exe build -t agent-service:smoke ./agent-service

# Run the API scaffold
docker.exe run -d --name agent-smoke -p 8009:8000 agent-service:smoke
curl http://localhost:8009/health          # -> {"status":"ok"}
```

### Gym rollout & BC training (via `docker exec`)

```bash
# Random-action rollout, fully offline
docker.exe exec agent-smoke python -m app.rollout --seed 0

# Rollout with the LIVE optimizer seam adjudicating a terminal feasibility reward
docker.exe exec -e OPTIMIZER_URL=http://host.docker.internal:8001 \
  agent-smoke python -m app.rollout --seed 3 --use-optimizer

# Cold-start behavior cloning on the tiny sample
docker.exe exec agent-smoke python -m app.train_bc --dataset data/coldstart_sample.jsonl --epochs 1
```

### Tests (parity + env + health)

The parity test reads the frozen optimizer contract, which is **outside** this build context, so
copy it in and point the test at it:

```bash
docker.exe exec agent-smoke mkdir -p /ref
docker.exe cp ./grafik-optimizer/app/contract.py agent-smoke:/ref/contract.py
docker.exe exec -e OPTIMIZER_CONTRACT_PATH=/ref/contract.py agent-smoke python -m pytest -q
```

## Consuming the FROZEN contract (mirror + parity)

`ProblemInput`/`SolveResult` is **FROZEN**; its canonical source is
`packages/shared/src/grafik/contract.ts` (Zod), mirrored in `grafik-optimizer/app/contract.py`
(pydantic). agent-service keeps its **own** mirror at `app/contract.py` and a **parity test**
(`tests/test_contract_parity.py`) that loads the optimizer's mirror by path and asserts field-for-
field + enum equality — the same schema-parity idiom the repo uses elsewhere (root `CLAUDE.md`
"Prisma enums"). We never edit or import across the boundary; the test holds the line.

## Smoke evidence (captured on this task)

Built and run via `docker.exe` (Docker Desktop Server 29.4.1), image `agent-service:smoke`:

```
===== 1. RUN + HEALTH =====
GET /health -> 200 {"status":"ok"}

===== 2. PYTEST (parity + env + health), frozen contract copied in =====
.........                                                                [100%]
9 passed in 3.01s

===== 3. GYM RANDOM ROLLOUT (offline) =====
  step 0: action=28 reward=-1.00 kind=invalid_padding
  step 1: action=21 reward=-1.00 kind=invalid_padding
rollout complete: 2 steps, total_reward=-2.00

===== 4. BC TRAIN on tiny sample =====
loaded 2 cold-start sample(s) from data/coldstart_sample.jsonl
built 4 expert transition(s); action_dim=33
BC training complete: 1 epoch(s) over 4 transition(s)
```

Live optimizer seam — same seed, offline vs online (the `-2` delta is the solver's terminal
adjudication of two coverable demands the random agent left unmet):

```
--- seed 3 OFFLINE ---  total_reward=-2.00
--- seed 3 ONLINE  ---  total_reward=-4.00   (step 1: -1.00 base + -2.00 optimizer)
```

## Intended future `docker-compose.yml` `agent`-slot wiring — DOC ONLY

> **This task does NOT edit `docker-compose.yml`.** Wiring the reserved `agent` slot's build/command
> is a cross-team change signed off separately (firstmate routes it). The block below documents the
> *intended* wiring so that change is a copy-paste. The reserved slot today still points its build
> context at `./grafik-optimizer`; the intended change repoints it at **this** `./agent-service`
> image and gives it a command.

```yaml
  # RL agent — self-learning scheduling service. Built from ./agent-service (its OWN image, NOT the
  # lean CP-SAT optimizer image). Gated behind the "agent" profile so it never starts via `up -d`.
  agent:
    profiles: ["agent"]
    build:
      context: ./agent-service        # was ./grafik-optimizer — repoint to this image
      dockerfile: Dockerfile
    environment:
      PYTHONUNBUFFERED: "1"
      # In-network the env seam reaches the optimizer by service name, not localhost:
      OPTIMIZER_URL: "http://optimizer:8000"
    depends_on:
      - optimizer
    # M2-C1 phase B: serve the health/API scaffold. M2-C2 swaps this for the agent serving loop.
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
    # ports:   # expose only once /agent/* endpoints land (M2-C2)
    #   - "8002:8000"
```
