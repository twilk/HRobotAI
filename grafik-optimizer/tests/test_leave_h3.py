"""H3 (availability / approved leave) regression tests — synthetic data only (RODO).

Guards the leave data-gap closed by M2 leave support: once ``approvedLeaveDates`` is packed from the
tenant ``LeaveRequest`` rows, the solver must treat an approved-leave date as a HARD constraint —
the employee is never assigned any demand falling on one of their leave dates.

H3 is enforced *structurally* in ``app/solver.py``: ``leave = {e.id: set(e.approvedLeaveDates)}`` and
``eligible()`` requires ``d.date not in leave[e_id]``, so no decision var ``x[e, d]`` is ever created
for a demand on a leave date. These tests pin that behaviour from the outside via the public
``solve()`` — they must keep passing if the model is ever refactored.
"""

from __future__ import annotations

from app.contract import ProblemInput, SolveStatus
from app.solver import solve

WEEK_START = "2026-07-06"  # Monday
LEAVE_DATE = "2026-07-08"  # Wednesday of the solved week

_LOCATIONS = [{"id": "loc-1", "latLng": {"lat": 52.23, "lng": 21.01}}]


def _problem(employees, demands) -> ProblemInput:
    return ProblemInput(
        horizon={"weekStart": WEEK_START},
        locations=_LOCATIONS,
        employees=employees,
        demands=demands,
        travelMatrix=[],
        weights={"d": 100, "e": 10, "g": 1},
        solverConfig={"seed": 7, "timeLimit": 30},
    )


def _leave_violations(problem: ProblemInput, assignments) -> list[str]:
    """Any assignment that puts an employee on a demand dated within their approved leave."""
    demand_date = {d.id: d.date for d in problem.demands}
    leave = {e.id: set(e.approvedLeaveDates) for e in problem.employees}
    return [
        f"H3: {a.employeeId} assigned {a.demandId} on leave date {demand_date[a.demandId]}"
        for a in assignments
        if demand_date[a.demandId] in leave.get(a.employeeId, set())
    ]


def test_h3_on_leave_employee_never_assigned_on_leave_date() -> None:
    """A qualified employee on approved leave is never assigned a demand on that date; a second
    qualified employee covers it instead → feasible with zero H3 violations."""
    employees = [
        {"id": "emp-A", "qualifications": ["KASJER"], "etat": 1.0, "homeLatLng": None,
         "approvedLeaveDates": [LEAVE_DATE], "historyHours": 0},
        {"id": "emp-B", "qualifications": ["KASJER"], "etat": 1.0, "homeLatLng": None,
         "approvedLeaveDates": [], "historyHours": 0},
    ]
    demands = [
        {"id": "d-wed", "locId": "loc-1", "date": LEAVE_DATE, "start": "08:00", "end": "16:00", "role": "KASJER", "count": 1},
    ]
    problem = _problem(employees, demands)

    result = solve(problem)

    assert result.status in (SolveStatus.OPTIMAL, SolveStatus.FEASIBLE)
    assert _leave_violations(problem, result.assignments) == []
    # The slot is covered — by emp-B, the only available qualified employee.
    covering = [a.employeeId for a in result.assignments if a.demandId == "d-wed"]
    assert covering == ["emp-B"]


def test_h3_only_qualified_employee_on_leave_is_infeasible() -> None:
    """If the ONLY qualified employee is on approved leave for the demand's date, that slot is
    uncoverable → INFEASIBLE with the slot reported in unmet, and no assignment for it."""
    employees = [
        {"id": "emp-A", "qualifications": ["KASJER"], "etat": 1.0, "homeLatLng": None,
         "approvedLeaveDates": [LEAVE_DATE], "historyHours": 0},
    ]
    demands = [
        {"id": "d-wed", "locId": "loc-1", "date": LEAVE_DATE, "start": "08:00", "end": "16:00", "role": "KASJER", "count": 1},
    ]
    problem = _problem(employees, demands)

    result = solve(problem)

    assert result.status == SolveStatus.INFEASIBLE
    assert "d-wed" in {u.demandId for u in result.unmet}
    # emp-A is on leave that date → structurally no var exists → never assigned.
    assert all(a.demandId != "d-wed" for a in result.assignments)
    assert _leave_violations(problem, result.assignments) == []
