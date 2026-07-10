"""``/agent/*`` router — the five capability handlers (spec §5), M2-C2.

Replaces the M2-C1 phase-B 501 seams with working handlers. Each is a thin adapter over
:class:`AgentService`; the learning, tenant-isolated persistence, and solver reconciliation live
there. Shapes match spec §5 exactly and are additive to the frozen #1 contract. The prefix/tags stay
as the phase-B seam fixed them, so this is a pure fill-in of the deferred handlers.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query

from .fixtures import resolve_problem
from .forecast import forecast_demand
from .schemas import FeedbackRequest, ForecastRequest, HealRequest, ProposeRequest
from .service import AgentService, DEFAULT_TENANT
from .store import AgentStore

router = APIRouter(prefix="/agent", tags=["agent"])

# One store + service per process. AGENT_DB_PATH selects the SQLite file (default /data/agent.db).
_store = AgentStore()
_service = AgentService(_store)


def _resolve(problem_input_id, problem):
    if problem is not None:
        return problem
    if problem_input_id:
        resolved = resolve_problem(problem_input_id)
        if resolved is None:
            raise HTTPException(status_code=404, detail=f"unknown problemInputId '{problem_input_id}'")
        return resolved
    raise HTTPException(status_code=422, detail="provide problem or problemInputId")


@router.post("/propose")
def propose(req: ProposeRequest):
    problem = _resolve(req.problemInputId, req.problem)
    return _service.propose(req.tenantId, problem)


@router.post("/feedback")
def feedback(req: FeedbackRequest):
    edits = [e.model_dump() for e in req.edits]
    result = _service.feedback(req.tenantId, req.proposalId, edits, req.accepted)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "feedback failed"))
    return result


@router.post("/heal")
def heal(req: HealRequest):
    ip = req.infeasibleProposal
    problem = _resolve(ip.problemInputId, ip.problem)
    try:
        return _service.heal(problem, ip.assignments)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"live solver unreachable: {exc}")


@router.get("/explain")
def explain(
    proposalId: str = Query(...),
    demandId: str | None = Query(default=None),
    tenantId: str = Query(default=DEFAULT_TENANT),
):
    result = _service.explain(tenantId, proposalId, demandId)
    if result is None:
        raise HTTPException(status_code=404, detail="unknown proposalId for tenant")
    return result


@router.post("/forecast")
def forecast(req: ForecastRequest):
    return {"predictedDemand": forecast_demand(req.locationId, req.horizon)}


@router.get("/policy")
def policy(tenantId: str = Query(default=DEFAULT_TENANT)):
    return _service.policy_info(tenantId)
