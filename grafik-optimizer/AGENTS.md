# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Running tests

Pinned `ortools` (see `requirements.txt`) ships wheels only for CPython 3.9–3.12 — matching the
`python:3.12-slim` base in `Dockerfile`. A newer system Python (e.g. 3.14) has no ortools wheel, so
create the venv on 3.12. If `pip`/`ensurepip` are missing, `uv` provisions both:

```
uv venv --python 3.12 .venv
uv pip install --python .venv -r requirements.txt httpx pytest
.venv/bin/python -m pytest        # G1–G4 in tests/test_solver.py + API round-trip in test_solve.py
```

Solver model, determinism, and INFEASIBLE handling are documented in `app/solver.py`'s module
docstring and `README.md` — read those before changing the objective or constraints.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
