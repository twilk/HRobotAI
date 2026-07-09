# grafik-optimizer

FastAPI service that solves the weekly staffing grafik. **This is the M2-A1 skeleton** — it
carries the frozen solver contract and a STUB `/solve`; the CP-SAT model is M2-A2.

## Endpoints

| Method | Path      | Behaviour                                                                 |
| ------ | --------- | ------------------------------------------------------------------------- |
| `GET`  | `/health` | Liveness — `{"status":"ok"}`.                                             |
| `POST` | `/solve`  | Parses a `ProblemInput`, returns a schema-valid `SolveResult` **stub** (`INFEASIBLE`, every demand `unmet`). No OR-Tools yet. |

## Contract parity

`app/contract.py` (pydantic) mirrors, field for field, the Zod source of truth in
`packages/shared/src/grafik/contract.ts` (exported via `@hrobot/shared`). The envelope is
frozen for D1 — additive optional fields only through D3. Keep the two files in lockstep.

Determinism (added in A2): the solver runs `num_search_workers=1` with `solverConfig.seed`.
Output is reproducible under `OPTIMAL`; **not** promised bit-identical under a hit time-limit /
`FEASIBLE`.

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

## Reserved for later tracks

- **M2-A2** — CP-SAT model in `/solve` (H1–H4 hard, haversine commute, L1 etat-deviation; H5 as a
  soft ">= N free days/week" proxy). `ortools` is already pinned in `requirements.txt`.
- **RL agent (#2)** — shares this image/container via the `agent` slot in `docker-compose.yml`.
