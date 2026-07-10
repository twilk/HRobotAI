"""Backward-compat for the ADDITIVE employee-preference fields on the frozen contract.

The FOUNDATION phase adds only NEW OPTIONAL fields (``EmployeeInput.preferences``, ``Weights.p``,
``Metrics.preferencesHonoredPct``). This test pins the koperta/additive guarantee: a message from a
preference-UNAWARE peer (no ``preferences``, weights ``{d,e,g}`` with no ``p``, metrics with no
``preferencesHonoredPct``) MUST still parse, and a NEW message carrying the fields parses too.
"""

from __future__ import annotations

from app.contract import EmployeeInput, Metrics, ProblemInput, SolveResult, Weights

_OLD_PROBLEM = {
    "horizon": {"weekStart": "2026-07-06"},
    "locations": [{"id": "loc-1", "latLng": {"lat": 52.23, "lng": 21.01}}],
    "employees": [
        {
            "id": "emp-1",
            "qualifications": ["KASJER"],
            "etat": 1.0,
            "homeLatLng": {"lat": 52.24, "lng": 21.02},
            "approvedLeaveDates": ["2026-07-08"],
            "historyHours": 160,
        }
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
        }
    ],
    "travelMatrix": [{"employeeId": "emp-1", "locId": "loc-1", "minutes": 12}],
    "weights": {"d": 100, "e": 10, "g": 1},
    "solverConfig": {"seed": 42, "timeLimit": 30},
}

_OLD_RESULT = {
    "status": "INFEASIBLE",
    "assignments": [],
    "metrics": {"commuteTotal": 0, "etatDeviation": 0, "fairnessScore": 0},
    "unmet": [{"demandId": "dem-1", "reason": "stub"}],
}


def test_old_problem_without_preferences_or_p_still_parses() -> None:
    parsed = ProblemInput.model_validate(_OLD_PROBLEM)
    assert parsed.weights.p is None
    assert parsed.employees[0].preferences is None


def test_old_result_without_preferences_honored_pct_still_parses() -> None:
    parsed = SolveResult.model_validate(_OLD_RESULT)
    assert parsed.metrics.preferencesHonoredPct is None


def test_new_problem_with_preferences_and_p_parses() -> None:
    emp = EmployeeInput.model_validate(
        {
            **_OLD_PROBLEM["employees"][0],
            "preferences": {"preferredDaysOff": ["SAT", "SUN"], "preferredShiftStart": ["08:00"]},
        }
    )
    assert emp.preferences is not None
    assert emp.preferences.preferredDaysOff == ["SAT", "SUN"]
    assert emp.preferences.preferredShiftStart == ["08:00"]
    assert Weights.model_validate({"d": 100, "e": 10, "g": 1, "p": 5}).p == 5


def test_new_result_with_preferences_honored_pct_parses() -> None:
    m = Metrics.model_validate(
        {"commuteTotal": 0, "etatDeviation": 0, "fairnessScore": 0, "preferencesHonoredPct": 0.75}
    )
    assert m.preferencesHonoredPct == 0.75
