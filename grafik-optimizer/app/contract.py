"""Grafik solver contract — pydantic mirror of the FROZEN envelope.

This file MUST describe the identical shape, field for field, as the Zod source of truth in
`packages/shared/src/grafik/contract.ts` (exported via `@hrobot/shared`). Field names stay
camelCase here (matching the wire JSON) so the two sides parse the same payload with no
key translation.

Envelope is frozen for D1; changes must stay ADDITIVE (new optional fields only, through D3).
No solver logic lives here — see `main.py` for the STUB `/solve`; CP-SAT is M2-A2.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class SolveStatus(str, Enum):
    OPTIMAL = "OPTIMAL"
    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"


class DemandSource(str, Enum):
    """Parity with Prisma `DemandSource`."""

    TEMPLATE = "TEMPLATE"
    MANUAL = "MANUAL"


# --- shared leaf shapes -------------------------------------------------------------------------


class LatLng(BaseModel):
    """WGS84 coordinate used for haversine commute."""

    lat: float
    lng: float


# --- ProblemInput -------------------------------------------------------------------------------


class Horizon(BaseModel):
    #: Monday of the week being solved, ISO ``YYYY-MM-DD``.
    weekStart: str


class LocationInput(BaseModel):
    id: str
    latLng: LatLng | None = None


class EmployeeInput(BaseModel):
    id: str
    #: Roles this employee can cover (matched against demand.role).
    qualifications: list[str]
    #: Contract fraction; targetWeeklyHours = etat * 40.
    etat: float
    #: Home coordinate for commute; ``None`` when unknown.
    homeLatLng: LatLng | None
    #: Approved leave dates (ISO ``YYYY-MM-DD``) — H3 hard block.
    approvedLeaveDates: list[str]
    #: Hours already worked in the reference period (etat-deviation / fairness).
    historyHours: float


class DemandInput(BaseModel):
    id: str
    locId: str
    #: ISO ``YYYY-MM-DD``.
    date: str
    #: Window start/end as ``HH:mm`` local time.
    start: str
    end: str
    role: str
    count: int


class TravelEntry(BaseModel):
    """One employee->location commute cost (minutes), precomputed via haversine on the caller side."""

    employeeId: str
    locId: str
    minutes: float


class Weights(BaseModel):
    """Objective weights: ``d`` demand/unmet, ``e`` etat-deviation (L1), ``g`` geo/commute."""

    d: float
    e: float
    g: float


class SolverConfig(BaseModel):
    """Determinism + budget knobs. ``seed`` fixes the search; ``timeLimit`` is seconds."""

    seed: int
    timeLimit: float


class ProblemInput(BaseModel):
    horizon: Horizon
    locations: list[LocationInput]
    employees: list[EmployeeInput]
    demands: list[DemandInput]
    travelMatrix: list[TravelEntry]
    weights: Weights
    solverConfig: SolverConfig


# --- SolveResult --------------------------------------------------------------------------------


class Assignment(BaseModel):
    employeeId: str
    demandId: str


class Metrics(BaseModel):
    commuteTotal: float
    etatDeviation: float
    #: Reserved placeholder until fairness-variance (M3).
    fairnessScore: float


class Unmet(BaseModel):
    demandId: str
    reason: str


class SolveResult(BaseModel):
    status: SolveStatus
    assignments: list[Assignment]
    metrics: Metrics
    unmet: list[Unmet]
