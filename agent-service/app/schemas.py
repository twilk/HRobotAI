"""Request/response models for the ``/agent/*`` API (spec §5 shapes).

Additive to the frozen #1 contract — these wrap ``ProblemInput``/``Assignment`` without renaming any
frozen field. ``tenantId`` is optional on the wire and defaults to the demo tenant; in production it
comes from the authenticated session (tenant isolation, AG6).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .contract import Assignment, ProblemInput
from .service import DEFAULT_TENANT


class ProposeRequest(BaseModel):
    problemInputId: str | None = None
    problem: ProblemInput | None = None
    tenantId: str = DEFAULT_TENANT


class Edit(BaseModel):
    editType: str  # MOVE | SWAP | REMOVE | ACCEPT | REJECT
    demandId: str | None = None
    employeeId: str | None = None
    fromEmployeeId: str | None = None
    toEmployeeId: str | None = None
    otherDemandId: str | None = None
    otherEmployeeId: str | None = None


class FeedbackRequest(BaseModel):
    proposalId: str
    edits: list[Edit] = Field(default_factory=list)
    accepted: bool = False
    tenantId: str = DEFAULT_TENANT


class HealRequest(BaseModel):
    # An infeasible proposal = a problem plus the (possibly broken) assignments to repair.
    infeasibleProposal: "InfeasibleProposal"
    tenantId: str = DEFAULT_TENANT


class InfeasibleProposal(BaseModel):
    problem: ProblemInput | None = None
    problemInputId: str | None = None
    assignments: list[Assignment] = Field(default_factory=list)


class ForecastRequest(BaseModel):
    locationId: str
    horizon: int = 7
    tenantId: str = DEFAULT_TENANT


HealRequest.model_rebuild()
