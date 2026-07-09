"""grafik-optimizer — FastAPI service scaffold (M2-A1 skeleton).

Exposes:
  GET  /health  — liveness probe.
  POST /solve   — parses a ProblemInput and returns a schema-valid SolveResult **STUB**.

There is intentionally NO CP-SAT / OR-Tools logic here: the stub returns ``INFEASIBLE`` with
no assignments and every demand echoed into ``unmet``. Real solving (num_search_workers=1 +
fixed seed for determinism) lands in M2-A2. ortools is already pinned in requirements.txt so A2
has its deps in place.
"""

from __future__ import annotations

from fastapi import FastAPI

from .contract import Metrics, ProblemInput, SolveResult, SolveStatus, Unmet

app = FastAPI(title="grafik-optimizer", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResult)
def solve(problem: ProblemInput) -> SolveResult:
    """STUB: validates the contract and returns a schema-valid placeholder result.

    Every demand is reported as unmet so callers can wire the round-trip before A2 exists.
    """
    return SolveResult(
        status=SolveStatus.INFEASIBLE,
        assignments=[],
        metrics=Metrics(commuteTotal=0.0, etatDeviation=0.0, fairnessScore=0.0),
        unmet=[Unmet(demandId=d.id, reason="stub: solver not yet implemented (M2-A2)") for d in problem.demands],
    )
