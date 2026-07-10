"""Router SEAM for the agent endpoints — implemented in the NEXT backlog item (M2-C2).

`/agent/propose | feedback | heal | explain | forecast` are intentionally NOT implemented in
M2-C1 phase B. This router is wired into the app (see ``main.py``) so the surface, prefix, and
tags are fixed now and M2-C2 only fills in the handlers. Each stub returns HTTP 501 so a caller
gets an honest "not built yet" rather than a 404 that looks like a routing bug.

Do NOT implement policy inference / self-heal here; that is M2-C2 (serving) and M2-C3 (RL).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/agent", tags=["agent (M2-C2 — not yet implemented)"])

# Planned surface for M2-C2. Kept as data so the seam is self-documenting.
_PLANNED_ENDPOINTS = {
    "propose": "Return a proposed assignment set for a ProblemInput (policy inference).",
    "feedback": "Ingest manager accept/reject to shape reward (RLHF-style signal).",
    "heal": "Repair an infeasible/edited schedule via the propose→/solve→repair loop.",
    "explain": "Explain why a proposal was made (feature attributions / constraints).",
    "forecast": "Forecast future demand / staffing gaps.",
}


def _not_implemented(name: str):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"/agent/{name} is planned for M2-C2: {_PLANNED_ENDPOINTS[name]}",
    )


@router.post("/propose")
def propose() -> None:
    _not_implemented("propose")


@router.post("/feedback")
def feedback() -> None:
    _not_implemented("feedback")


@router.post("/heal")
def heal() -> None:
    _not_implemented("heal")


@router.post("/explain")
def explain() -> None:
    _not_implemented("explain")


@router.get("/forecast")
def forecast() -> None:
    _not_implemented("forecast")
