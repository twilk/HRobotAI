"""HON-2 — AG2 measured against an **independently defined** manager preference.

The original AG2 scenario builds its reference schedule by calling the agent's own
``ImitationPolicy.propose``. These tests pin the honest version: a manager roster produced by
:mod:`app.manager_profile`, which never touches the agent's policy, plus the literal curves the
run produces so a silent regression in either direction is visible in the diff.
"""

from __future__ import annotations

import pytest

from app.demo_ag2 import (
    MANAGER_CONSTRUCTED,
    MANAGER_INDEPENDENT,
    manager_truth,
    run_demo,
)
from app.fixtures import canonical_problem
from app.manager_profile import ManagerProfile, independent_manager_schedule, manager_taste
from app.metrics import edit_distance
from app.policy import ImitationPolicy
from app.validate import validate

#: Literal curves from the committed run (deterministic — no RNG anywhere in the loop).
CURVE_INDEPENDENT_FEEDBACK = [
    96, 76, 62, 70, 60, 52, 50, 52, 44, 40,
    34, 36, 28, 26, 20, 16, 10, 0, 0, 0,
]
CURVE_CONSTRUCTED_FEEDBACK = [50, 44, 28, 18, 4, 0]


def _curve(result) -> list[int]:
    return [h["editDistance"] for h in result["history"]]


# --- the reference schedule is genuinely independent of the agent --------------------------------


def test_independent_reference_never_calls_the_agent_policy(monkeypatch):
    """Structural guarantee: build the manager roster with ``propose`` sabotaged."""

    def explode(*_args, **_kwargs):  # pragma: no cover - only runs if the guarantee breaks
        raise AssertionError("independent_manager_schedule must not call ImitationPolicy.propose")

    monkeypatch.setattr(ImitationPolicy, "propose", explode)
    schedule = independent_manager_schedule(canonical_problem(), ManagerProfile())
    assert len(schedule) == 52


def test_independent_reference_differs_from_the_constructed_one():
    problem = canonical_problem()
    independent = manager_truth(problem, MANAGER_INDEPENDENT)
    constructed = manager_truth(problem, MANAGER_CONSTRUCTED)
    assert edit_distance(independent, constructed) == 96


def test_independent_reference_is_hard_feasible_and_fully_covers_demand():
    """Fair comparison: the target must be a legal roster, else the agent could never reach it."""
    problem = canonical_problem()
    schedule = manager_truth(problem, MANAGER_INDEPENDENT)
    report = validate(problem, schedule)
    assert report.feasible, report.as_wire()
    assert len(schedule) == 52
    assert sum(d.count for d in problem.demands) == 52


def test_manager_taste_is_deterministic_and_band_dependent():
    assert manager_taste("emp-1", "EARLY") == manager_taste("emp-1", "EARLY")
    assert manager_taste("emp-1", "EARLY") != manager_taste("emp-1", "LATE")
    assert 0.0 <= manager_taste("emp-1", "EARLY") < 1.0


# --- the measured result -------------------------------------------------------------------------


def test_day_one_gap_is_much_larger_than_the_constructed_scenario():
    """Cold start agrees with the independent manager on ~8% of the roster, not ~52%."""
    independent = run_demo(rounds=1, manager=MANAGER_INDEPENDENT)
    constructed = run_demo(rounds=1, manager=MANAGER_CONSTRUCTED)
    assert _curve(independent)[0] == 96
    assert _curve(constructed)[0] == 50
    assert independent["history"][0]["acceptanceMetric"] == 0.0769
    assert constructed["history"][0]["acceptanceMetric"] == 0.5192


def test_agent_converges_to_the_independent_manager_preference():
    """The headline HON-2 result: 96 -> 0, but it takes 17 rounds instead of 5."""
    result = run_demo(rounds=20, correction_budget=6, use_feedback=True, manager=MANAGER_INDEPENDENT)
    dists = _curve(result)
    assert dists == CURVE_INDEPENDENT_FEEDBACK
    assert dists.index(0) == 17


def test_convergence_against_the_independent_manager_is_not_monotone():
    """Honest counterpart to the constructed scenario: the curve rises again in places.

    Pinning this stops the README/evidence pack from quietly re-acquiring the word "monotone" for
    the independent case — it holds only for the reference the agent's own operator built.
    """
    dists = _curve(run_demo(rounds=20, correction_budget=6, manager=MANAGER_INDEPENDENT))
    assert not all(b <= a for a, b in zip(dists, dists[1:]))
    rises = [(i, dists[i], dists[i + 1]) for i in range(len(dists) - 1) if dists[i + 1] > dists[i]]
    assert rises == [(2, 62, 70), (6, 50, 52), (10, 34, 36)]


def test_no_feedback_stays_flat_against_the_independent_manager():
    """Ablation: the whole drop is learning — with feedback off nothing moves at all."""
    dists = _curve(run_demo(rounds=6, use_feedback=False, manager=MANAGER_INDEPENDENT))
    assert dists == [96, 96, 96, 96, 96, 96]


def test_constructed_scenario_still_converges_faster():
    """The contrast that makes the HON-2 caveat worth stating in the evidence pack."""
    assert _curve(run_demo(rounds=6, correction_budget=6)) == CURVE_CONSTRUCTED_FEEDBACK


def test_result_metadata_names_how_the_reference_was_built():
    """The artifact must carry its own provenance — that is the point of HON-2."""
    independent = run_demo(rounds=1, manager=MANAGER_INDEPENDENT)
    constructed = run_demo(rounds=1, manager=MANAGER_CONSTRUCTED)
    assert "never calls the agent's policy" in independent["managerReferenceBuiltBy"]
    assert "the agent's OWN operator" in constructed["managerReferenceBuiltBy"]


def test_unknown_manager_model_is_rejected():
    with pytest.raises(ValueError, match="unknown manager model"):
        manager_truth(canonical_problem(), "wishful-thinking")
