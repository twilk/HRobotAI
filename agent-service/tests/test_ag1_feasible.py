"""AG1 — the agent proposes a schedule the LIVE solver confirms feasible.

The live-solver check skips when the optimizer is unreachable; the container smoke covers it.
"""

from __future__ import annotations

import pytest

from app.contract import Assignment
from app.fixtures import canonical_problem, canonical_solution
from app.policy import ImitationPolicy, PolicyState
from app.validate import validate
from tests.conftest import optimizer_up


def _cold_start_policy() -> ImitationPolicy:
    """A day-1 policy cloned from the solver teacher (the M2-C2 serving-side BC)."""
    state = PolicyState(version=1)
    policy = ImitationPolicy(state)
    policy.apply_teacher_assignments(canonical_problem(), canonical_solution())
    return policy


def test_cold_start_proposal_is_locally_feasible():
    problem = canonical_problem()
    assignments, _ = _cold_start_policy().propose(problem)
    report = validate(problem, assignments)
    assert report.feasible, report.as_wire()


@pytest.mark.skipif(not optimizer_up(), reason="live optimizer not reachable")
def test_cold_start_proposal_feasible_under_live_solver():
    from app.optimizer_client import OptimizerClient

    problem = canonical_problem()
    assignments, _ = _cold_start_policy().propose(problem)
    result = OptimizerClient().solve(problem)
    assert result.status.value in ("OPTIMAL", "FEASIBLE")
    assert validate(problem, assignments).feasible
