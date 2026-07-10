"""AG2 — feedback drives a measurable, monotone edit-distance drop on the fixed scenario."""

from __future__ import annotations

from app.demo_ag2 import run_demo


def test_edit_distance_drops_monotonically_with_feedback():
    result = run_demo(rounds=6, correction_budget=6, use_feedback=True)
    dists = [h["editDistance"] for h in result["history"]]
    # measurable drop
    assert dists[-1] < dists[0], f"no drop: {dists}"
    # monotone non-increasing on the fixed scenario
    assert all(b <= a for a, b in zip(dists, dists[1:])), f"not monotone: {dists}"
    # converges toward the manager-accepted schedule
    assert dists[-1] == 0, f"did not converge: {dists}"
    # policy version progresses (self-development, AG5)
    versions = [h["policyVersion"] for h in result["history"]]
    assert versions[-1] > versions[0]


def test_no_feedback_stays_flat():
    """The drop must come from learning: with feedback disabled the curve is flat."""
    result = run_demo(rounds=5, use_feedback=False)
    dists = [h["editDistance"] for h in result["history"]]
    assert len(set(dists)) == 1, f"expected flat curve without feedback: {dists}"


def test_acceptance_metric_rises():
    result = run_demo(rounds=6, correction_budget=6, use_feedback=True)
    acc = [h["acceptanceMetric"] for h in result["history"]]
    assert acc[-1] > acc[0]
    assert acc[-1] == 1.0
