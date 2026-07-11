"""Grafik solver contract — the agent-service's OWN pydantic mirror of the FROZEN envelope.

This file MUST describe the identical shape, field for field, as:
  * the Zod source of truth in ``packages/shared/src/grafik/contract.ts`` (``@hrobot/shared``), and
  * the optimizer's mirror in ``grafik-optimizer/app/contract.py``.

The contract is FROZEN (changes must stay ADDITIVE — new optional fields only). agent-service
consumes it via *mirror + parity test* rather than importing across service boundaries: see
``tests/test_contract_parity.py``, which loads ``grafik-optimizer/app/contract.py`` by path and
asserts field-for-field equality. That is the idiomatic consume path in this repo (schema-parity
tests, cf. root ``CLAUDE.md`` "Prisma enums"). Do NOT edit the frozen sources; edit this mirror
only to track an ADDITIVE change already made upstream, and let the parity test hold the line.

Field names stay camelCase (matching the wire JSON) so every side parses the same payload with no
key translation.
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


class EmployeePreferences(BaseModel):
    """Soft scheduling preferences. Both fields are SOFT — optimized toward, never guaranteed.

    ADDITIVE optional extension of the frozen contract; a preference-unaware peer that omits this
    object stays valid. agent-service mirrors it for parity but does NOT read it (preference-unaware).
    """

    #: Weekday codes (``MON``..``SUN``) the employee would rather NOT be scheduled on (soft).
    preferredDaysOff: list[str] | None = None
    #: Preferred shift start times as ``HH:mm`` strings — those start times are preferred (soft).
    preferredShiftStart: list[str] | None = None


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
    #: Soft scheduling preferences (optional; absent == no preferences).
    preferences: EmployeePreferences | None = None


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
    #: Preference-objective weight (soft employee preferences). OPTIONAL — an older caller sending
    #: ``{d,e,g}`` still validates; a consumer treats a missing ``p`` as 0 (no preference optimization).
    p: float | None = None


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
    #: Fraction (0..1) of assignments honoring the assigned employee's preferences; solver fills it
    #: later. OPTIONAL so an existing result without it still validates.
    preferencesHonoredPct: float | None = None


class Unmet(BaseModel):
    demandId: str
    reason: str


class SolveResult(BaseModel):
    status: SolveStatus
    assignments: list[Assignment]
    metrics: Metrics
    unmet: list[Unmet]
