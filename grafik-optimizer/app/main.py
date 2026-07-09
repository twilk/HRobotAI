"""grafik-optimizer — FastAPI service (M2-A2).

Exposes:
  GET  /health  — liveness probe.
  POST /solve   — parses a ProblemInput and runs the CP-SAT solver, returning a SolveResult.

The real solver lives in ``solver.py`` (H1–H4 hard, H5 soft proxy, L1 etat-deviation, haversine
commute, deterministic ``num_search_workers=1`` + fixed seed). See that module for the model.
"""

from __future__ import annotations

from fastapi import FastAPI

from .contract import ProblemInput, SolveResult
from .solver import solve as solve_problem

app = FastAPI(title="grafik-optimizer", version="0.2.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResult)
def solve(problem: ProblemInput) -> SolveResult:
    """Validate the frozen ProblemInput contract and run the CP-SAT solver.

    Returns a schema-valid SolveResult: OPTIMAL/FEASIBLE with assignments + metrics when a
    schedule satisfying H1–H4 exists, otherwise INFEASIBLE with a non-empty ``unmet[]`` naming the
    uncoverable slots (never a silent error).
    """
    return solve_problem(problem)
