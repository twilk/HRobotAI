"""Request/response models for the ``/agent/*`` API (spec §5 shapes).

Additive to the frozen #1 contract — these wrap ``ProblemInput``/``Assignment`` without renaming any
frozen field. **No ``tenantId`` field**: the tenant is derived from the authenticated bearer token
(``app.deps.require_tenant``), never trusted from the request body/query — that is the M2
tenant-isolation fix (AG6). A ``tenantId`` sent by a caller is ignored (extra fields are dropped).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .contract import Assignment, ProblemInput


class ProposeRequest(BaseModel):
    problemInputId: str | None = None
    problem: ProblemInput | None = None


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


class HealRequest(BaseModel):
    # An infeasible proposal = a problem plus the (possibly broken) assignments to repair.
    infeasibleProposal: "InfeasibleProposal"


class InfeasibleProposal(BaseModel):
    problem: ProblemInput | None = None
    problemInputId: str | None = None
    assignments: list[Assignment] = Field(default_factory=list)


class ForecastRequest(BaseModel):
    locationId: str
    horizon: int = 7


class RetrainRequest(BaseModel):
    note: str | None = None


class ResetRequest(BaseModel):
    # Tenant-scoped reset to the cold-start baseline — never a blanket wipe. Tenant comes from auth.
    pass


HealRequest.model_rebuild()
