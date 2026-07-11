"""``/agent/*`` router — the five capability handlers (spec §5), M2-C2.

Replaces the M2-C1 phase-B 501 seams with working handlers. Each is a thin adapter over
:class:`AgentService`; the learning, tenant-isolated persistence, and solver reconciliation live
there. Shapes match spec §5 exactly and are additive to the frozen #1 contract. The prefix/tags stay
as the phase-B seam fixed them, so this is a pure fill-in of the deferred handlers.

**Auth (M2 tenant-isolation fix, AG6):** every handler depends on :func:`app.deps.require_tenant`,
which authenticates the bearer token and yields the caller's tenant slug from the token issuer. The
tenant is NEVER taken from the request body/query — a caller cannot act on another tenant by naming
it.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .deps import require_tenant
from .fixtures import resolve_problem
from .forecast import forecast_demand
from .schemas import (
    FeedbackRequest,
    ForecastRequest,
    HealRequest,
    ProposeRequest,
    ResetRequest,
    RetrainRequest,
)
from .service import AgentService
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
def propose(req: ProposeRequest, tenant: str = Depends(require_tenant)):
    problem = _resolve(req.problemInputId, req.problem)
    return _service.propose(tenant, problem)


@router.post("/feedback")
def feedback(req: FeedbackRequest, tenant: str = Depends(require_tenant)):
    edits = [e.model_dump() for e in req.edits]
    result = _service.feedback(tenant, req.proposalId, edits, req.accepted)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "feedback failed"))
    return result


@router.post("/heal")
def heal(req: HealRequest, tenant: str = Depends(require_tenant)):
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
    tenant: str = Depends(require_tenant),
):
    result = _service.explain(tenant, proposalId, demandId)
    if result is None:
        raise HTTPException(status_code=404, detail="unknown proposalId for tenant")
    return result


@router.post("/forecast")
def forecast(req: ForecastRequest, tenant: str = Depends(require_tenant)):
    return {"predictedDemand": forecast_demand(req.locationId, req.horizon)}


@router.post("/retrain")
def retrain(req: RetrainRequest, tenant: str = Depends(require_tenant)):
    """Trigger the formal batch retrain (M2-C3): re-fit from the full accumulated feedback log,
    producing a new versioned policy with a persisted training artifact. Distinct from the online
    nudge that ``/agent/feedback`` applies per-correction — see :mod:`app.retrain`."""
    return _service.retrain(tenant, note=req.note)


@router.post("/reset")
def reset(req: ResetRequest, tenant: str = Depends(require_tenant)):
    """Reset a single tenant to its untrained cold-start policy (demo affordance).

    Clears the tenant's feedback + policy-version history + learned policy state and re-derives the
    day-1 cold-start BC baseline, so a fresh ``propose`` is back at ~edit-distance 50 / ~52% agreement.
    Tenant-scoped (never a blanket wipe), deterministic, idempotent — see :meth:`AgentService.reset`."""
    return _service.reset(tenant)


@router.get("/policy")
def policy(tenant: str = Depends(require_tenant)):
    return _service.policy_info(tenant)
