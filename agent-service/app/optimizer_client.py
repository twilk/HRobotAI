"""Seam to the live grafik-optimizer ``POST /solve``.

The Gym environment (``env.py``) uses this to let the *real* CP-SAT solver adjudicate feasibility:
a proposal the agent leaves unmet on a demand the solver proves coverable is penalised, and a
proposal that names slots the solver reports INFEASIBLE is caught. This is the foundation of the
later self-heal loop (M2-C2): propose → check-with-solver → repair.

Base URL is configurable via the ``OPTIMIZER_URL`` env var (default ``http://localhost:8001``, the
port the optimizer is exposed on during this task's smoke run). The client is intentionally thin
and lazy: nothing here is imported at env construction time, so a random-action rollout runs fully
offline when ``use_optimizer=False`` (the default) and the optimizer container is not up.
"""

from __future__ import annotations

import os

import httpx

from .contract import ProblemInput, SolveResult

DEFAULT_OPTIMIZER_URL = "http://localhost:8001"


def optimizer_base_url() -> str:
    """Resolve the optimizer base URL from the environment (single source of truth)."""
    return os.environ.get("OPTIMIZER_URL", DEFAULT_OPTIMIZER_URL).rstrip("/")


class OptimizerClient:
    """Minimal HTTP client for the frozen ``/solve`` contract.

    Kept dependency-light on purpose; swap in retries/circuit-breaking when the self-heal loop
    (M2-C2) hardens this seam.
    """

    def __init__(self, base_url: str | None = None, timeout: float = 60.0) -> None:
        self.base_url = (base_url or optimizer_base_url()).rstrip("/")
        self.timeout = timeout

    def health(self) -> bool:
        """True iff the optimizer answers a healthy ``GET /health``."""
        try:
            resp = httpx.get(f"{self.base_url}/health", timeout=self.timeout)
            return resp.status_code == 200 and resp.json().get("status") == "ok"
        except (httpx.HTTPError, ValueError):
            return False

    def solve(self, problem: ProblemInput) -> SolveResult:
        """POST a ProblemInput and parse the SolveResult (raises on transport/HTTP error)."""
        resp = httpx.post(
            f"{self.base_url}/solve",
            json=problem.model_dump(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return SolveResult.model_validate(resp.json())
