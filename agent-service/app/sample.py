"""Tiny SYNTHETIC ProblemInput fixtures (RODO: no PII, invented ids/coords only).

Used by the smoke rollout, the env tests, and the BC sample dataset. Small on purpose.
"""

from __future__ import annotations

from .contract import ProblemInput

# A trivially feasible week: two qualified, available employees; two demand slots. Mirrors the
# shape the optimizer's own test fixture uses so the optimizer seam can adjudicate it too.
SAMPLE_PROBLEM_DICT: dict = {
    "horizon": {"weekStart": "2026-07-06"},
    "locations": [
        {"id": "loc-1", "latLng": {"lat": 52.23, "lng": 21.01}},
        {"id": "loc-2", "latLng": {"lat": 52.40, "lng": 16.92}},
    ],
    "employees": [
        {
            "id": "emp-1",
            "qualifications": ["KASJER", "MAGAZYNIER"],
            "etat": 1.0,
            "homeLatLng": {"lat": 52.24, "lng": 21.02},
            "approvedLeaveDates": ["2026-07-08"],
            "historyHours": 160,
        },
        {
            "id": "emp-2",
            "qualifications": ["KASJER"],
            "etat": 0.5,
            "homeLatLng": {"lat": 52.41, "lng": 16.93},
            "approvedLeaveDates": [],
            "historyHours": 80,
        },
    ],
    "demands": [
        {
            "id": "dem-1",
            "locId": "loc-1",
            "date": "2026-07-06",
            "start": "08:00",
            "end": "16:00",
            "role": "KASJER",
            "count": 1,
        },
        {
            "id": "dem-2",
            "locId": "loc-2",
            "date": "2026-07-07",
            "start": "09:00",
            "end": "17:00",
            "role": "KASJER",
            "count": 1,
        },
    ],
    "travelMatrix": [
        {"employeeId": "emp-1", "locId": "loc-1", "minutes": 12},
        {"employeeId": "emp-1", "locId": "loc-2", "minutes": 240},
        {"employeeId": "emp-2", "locId": "loc-1", "minutes": 250},
        {"employeeId": "emp-2", "locId": "loc-2", "minutes": 10},
    ],
    "weights": {"d": 100, "e": 10, "g": 1},
    "solverConfig": {"seed": 42, "timeLimit": 30},
}


def sample_problem() -> ProblemInput:
    """Parse the synthetic fixture into a validated ProblemInput."""
    return ProblemInput.model_validate(SAMPLE_PROBLEM_DICT)
