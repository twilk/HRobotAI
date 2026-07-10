"""Synthetic fixtures for the M2 demo — no PII, RODO-safe (spec §84).

The canonical problem/solution are the **cold-start dataset** reused from M2-C1: the frozen D2
synthetic seed solved by the CP-SAT teacher (spec §6, §81). ``canonical_problem.json`` is a real
``ProblemInput`` (36 employees, 38 demands) and ``canonical_solution.json`` its solver assignments
(52) — the imitation target for cold-start BC.

``resolve_problem`` backs ``/agent/propose {problemInputId}``: for M2 we resolve ids against this
in-memory fixture registry; the same endpoint also accepts a full ``problem`` inline. The synthetic
demand *history* is generated deterministically with weekly seasonality for the forecaster.
"""

from __future__ import annotations

import json
import os
from datetime import date, timedelta
from functools import lru_cache

from .contract import Assignment, ProblemInput

_FIXTURE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")

#: Stable ids callers can pass as ``problemInputId``.
CANONICAL_ID = "syn-canonical-feasible"
INFEASIBLE_ID = "syn-canonical-infeasible"


def _load(name: str) -> dict:
    with open(os.path.join(_FIXTURE_DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=None)
def canonical_problem() -> ProblemInput:
    return ProblemInput.model_validate(_load("canonical_problem.json"))


@lru_cache(maxsize=None)
def canonical_solution() -> list[Assignment]:
    data = _load("canonical_solution.json")
    return [Assignment.model_validate(a) for a in data["assignments"]]


@lru_cache(maxsize=None)
def infeasible_problem() -> ProblemInput:
    return ProblemInput.model_validate(_load("infeasible_problem.json"))


def resolve_problem(problem_input_id: str) -> ProblemInput | None:
    if problem_input_id in (CANONICAL_ID, "feasible__full"):
        return canonical_problem()
    if problem_input_id in (INFEASIBLE_ID, "infeasible__full"):
        return infeasible_problem()
    return None


# --- synthetic demand history with weekly seasonality (for /agent/forecast) --------------------

#: Role x day-of-week base head-count for the synthetic history. Monday=0 .. Sunday=6.
#: A weekday peak with a weekend trough — the seasonality the forecaster must recover.
_SEASONAL_BASE = {
    "KIEROWCA": [6, 6, 6, 7, 8, 4, 3],
    "SERWISANT": [4, 4, 5, 5, 5, 2, 1],
    "RECEPCJA": [2, 2, 2, 2, 3, 2, 1],
    "KOORDYNATOR": [1, 1, 1, 1, 1, 1, 1],
}


def synthetic_demand_history(location_id: str, weeks: int = 8, end: date | None = None) -> list[dict]:
    """Deterministic per-day demand totals for ``weeks`` back, with a fixed weekly pattern.

    Deterministic (no RNG): the count is ``base[role][dow]`` plus a small fixed location offset so
    different locations differ without introducing noise the seasonal model can't honestly recover.
    Returned rows: ``{date, dow, role, count}``.
    """
    end = end or date(2026, 7, 12)  # a Sunday, just before the canonical week
    loc_offset = (abs(hash(location_id)) % 3)  # 0..2, stable per location
    start = end - timedelta(days=weeks * 7 - 1)
    rows: list[dict] = []
    cur = start
    while cur <= end:
        dow = cur.weekday()
        for role, pattern in _SEASONAL_BASE.items():
            count = max(0, pattern[dow] + (loc_offset if role == "KIEROWCA" else 0))
            rows.append({"date": cur.isoformat(), "dow": dow, "role": role, "count": count})
        cur += timedelta(days=1)
    return rows
