"""AG3 self-healing — /agent/heal detects hard violations and repairs via the LIVE solver.

Skips gracefully when the optimizer is unreachable (unit envs); the container smoke exercises the
live path for the evidence pack.
"""

from __future__ import annotations

import pytest

from app.contract import Assignment, ProblemInput
from app.fixtures import canonical_problem
from app.validate import validate
from tests.conftest import optimizer_up

pytestmark = pytest.mark.skipif(not optimizer_up(), reason="live optimizer not reachable")


def _broken_assignments(problem: ProblemInput):
    """A deliberately infeasible proposal: assign an unqualified employee to a demand."""
    d = problem.demands[0]
    # find an employee that lacks the role (H1 violation)
    bad = next(e for e in problem.employees if d.role not in e.qualifications)
    return [Assignment(employeeId=bad.id, demandId=d.id)]


def test_local_validator_flags_the_break():
    problem = canonical_problem()
    report = validate(problem, _broken_assignments(problem))
    assert not report.feasible
    codes = {v.code for v in report.violations}
    assert "H1_QUALIFICATION" in codes


def test_heal_repairs_via_live_solver(client):
    problem = canonical_problem()
    broken = _broken_assignments(problem)
    payload = {
        "infeasibleProposal": {
            "problemInputId": "syn-canonical-feasible",
            "assignments": [a.model_dump() for a in broken],
        }
    }
    r = client.post("/agent/heal", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "repairedAssignments" in body and "whatWasWrong" in body
    # named the wrong
    assert any(w["code"] == "H1_QUALIFICATION" for w in body["whatWasWrong"])
    # the live solver produced a feasible schedule
    assert body["solverStatus"] in ("OPTIMAL", "FEASIBLE")
    repaired = [Assignment.model_validate(a) for a in body["repairedAssignments"]]
    assert validate(problem, repaired).feasible
