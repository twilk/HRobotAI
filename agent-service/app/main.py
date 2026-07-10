"""agent-service — FastAPI app (M2-C1 phase B skeleton).

Exposes:
  GET /health  — liveness probe, ``{"status": "ok"}``.

The ``/agent/*`` surface is mounted from ``agent_router`` as a documented SEAM returning 501; those
handlers are the next backlog item (M2-C2). No policy/training runs inside a request here — the
Gym-env (``env.py``) and BC entry point (``train_bc.py``) are the runnable artifacts of this task.
"""

from __future__ import annotations

from fastapi import FastAPI

from .agent_router import router as agent_router

app = FastAPI(title="agent-service", version="0.1.0")
app.include_router(agent_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
