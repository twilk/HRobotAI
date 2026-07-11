# grafik-optimizer

FastAPI service that solves the weekly staffing grafik with an **OR-Tools CP-SAT** model (M2-A2).
It carries the frozen solver contract and a real `/solve`.

## Endpoints

| Method | Path      | Behaviour                                                                 |
| ------ | --------- | ------------------------------------------------------------------------- |
| `GET`  | `/health` | Liveness — `{"status":"ok"}`.                                             |
| `POST` | `/solve`  | Parses a `ProblemInput`, runs the CP-SAT solver, returns a `SolveResult`: `OPTIMAL`/`FEASIBLE` with `assignments` + `metrics`, or `INFEASIBLE` with a non-empty `unmet[]` (never a silent error). |

## Solver model (`app/solver.py`)

Decision vars `x[e,d] ∈ {0,1}` — employee `e` covers demand slot `d`.

- **H1 coverage** — `Σ_e x[e,d] = d.count`; a var exists only when `d.role ∈ e.qualifications`.
- **H2 no overlap** + **H4 daily rest ≥ 11h** — one pairwise *conflict* relation over demands
  (two slots conflict when the time between them is `< 11h`, which subsumes overlap): for every
  employee eligible for both, `x[e,d1] + x[e,d2] ≤ 1`.
- **H3 availability** — baked into var eligibility (no var when `d.date ∈ e.approvedLeaveDates`).
- **H5 → soft proxy** — penalise, per employee, worked-days beyond `7 − MIN_FREE_DAYS_PER_WEEK`
  (a 1-week horizon can't model rolling 35h rest, so this is a nudge, not a hard rule).
- **Objective** — minimise `w_d·unmet + w_e·etatL1 + w_g·commute` (weights from the input), where
  `etatL1 = Σ_e |workedHours(e) − etat·40|` and commute uses `travelMatrix` (primary) with a
  haversine fallback (`app/commute.py`, OSRM-ready `CommuteProvider` interface).
- **fairness-variance** is deferred to M3 — `metrics.fairnessScore` is a stable `0.0` placeholder.

Feasibility is a two-phase solve: phase 1 with hard coverage; if H1–H4 can't all hold, phase 2
relaxes coverage to report exactly which slots are uncoverable in `unmet[]`.

## Contract parity

`app/contract.py` (pydantic) mirrors, field for field, the Zod source of truth in
`packages/shared/src/grafik/contract.ts` (exported via `@hrobot/shared`). The envelope is
frozen for D1 — additive optional fields only through D3. Keep the two files in lockstep.

Determinism: the solver runs `num_search_workers=1` with `random_seed = solverConfig.seed` and
`max_time_in_seconds = solverConfig.timeLimit`. Output is reproducible under `OPTIMAL`; **not**
promised bit-identical under a hit time-limit / `FEASIBLE`.

## Run locally (Docker)

```bash
docker compose --profile full up --build optimizer   # from repo root; serves on :8000
curl localhost:8000/health
```

## Run locally (without Docker)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt httpx pytest
uvicorn app.main:app --reload            # http://localhost:8000/docs
pytest                                   # smoke tests (tests/)
```

## Tests

`tests/test_solver.py` holds the G1–G4 acceptance tests (synthetic data only, RODO):
G1 feasible schedule with 0 hard-constraint violations, G2 metrics populated, G3 determinism at
`OPTIMAL`, G4 unsatisfiable input → `INFEASIBLE` + non-empty `unmet[]`. `tests/test_solve.py`
covers the FastAPI round-trip. Run `pytest` from `grafik-optimizer/`.

## Reserved for later tracks

- **RL agent (#2)** — shares this image/container via the `agent` slot in `docker-compose.yml`.
- **OSRM commute** — drop-in behind the `CommuteProvider` interface (`app/commute.py`).
- **Fairness-variance** — M3; `metrics.fairnessScore` is a reserved placeholder until then.
