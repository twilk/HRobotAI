"""Employee-preferences phase 2 — the SOFT preference objective term + preferencesHonoredPct.

Preferences are optimized toward, NEVER hard: coverage (H1) and H1–H4 stay hard, so a preference is
never guaranteed. These tests pin four properties (synthetic data only — RODO):

  * backward-compat — NO preferences and NO ``weights.p`` (or ``p == 0``) reproduces the exact
    baseline schedule + objective proxy; the preference machinery cannot regress existing behavior;
  * honored — when a feasible alternative exists, a high ``w_p`` makes the solver AVOID a violating
    assignment, and ``preferencesHonoredPct`` reflects it;
  * soft-not-hard — when honoring is impossible (sole qualified+available employee on their
    preferred day off), the slot is STILL covered (not INFEASIBLE) and ``preferencesHonoredPct`` < 1;
  * determinism — the preference-weighted solve is reproducible (2× identical at OPTIMAL).
"""

from __future__ import annotations

from app.contract import ProblemInput, SolveStatus
from app.solver import solve

WEEK_START = "2026-07-06"  # Monday
_LOC = [{"id": "loc-1", "latLng": {"lat": 52.23, "lng": 21.01}}]
_HOME = {"lat": 52.24, "lng": 21.02}


def _emp(emp_id: str, *, quals=None, preferences=None) -> dict:
    e = {
        "id": emp_id,
        "qualifications": quals or ["KASJER"],
        "etat": 1.0,
        "homeLatLng": _HOME,
        "approvedLeaveDates": [],
        "historyHours": 160,
    }
    if preferences is not None:
        e["preferences"] = preferences
    return e


def _demand(dem_id: str, date: str, *, start="08:00", end="16:00", role="KASJER") -> dict:
    return {
        "id": dem_id,
        "locId": "loc-1",
        "date": date,
        "start": start,
        "end": end,
        "role": role,
        "count": 1,
    }


def _problem(employees, demands, travel, weights) -> ProblemInput:
    return ProblemInput(
        **{
            "horizon": {"weekStart": WEEK_START},
            "locations": _LOC,
            "employees": employees,
            "demands": demands,
            "travelMatrix": travel,
            "weights": weights,
            "solverConfig": {"seed": 7, "timeLimit": 30},
        }
    )


def _canonical(assignments):
    return sorted((a.employeeId, a.demandId) for a in assignments)


# --- backward-compat (CRITICAL) -----------------------------------------------------------------
# Two KASJER employees, two non-conflicting Mon/Tue slots. emp-1 commutes cheaper (10 < 20), and
# etat-deviation is a tie whoever works, so covering BOTH slots with emp-1 is the unique optimum —
# a stable baseline that must NOT move when the preference machinery is present but inert.

_BC_EMPLOYEES = [_emp("emp-1"), _emp("emp-2")]
_BC_DEMANDS = [_demand("d-mon", "2026-07-06"), _demand("d-tue", "2026-07-07")]
_BC_TRAVEL = [
    {"employeeId": "emp-1", "locId": "loc-1", "minutes": 10},
    {"employeeId": "emp-2", "locId": "loc-1", "minutes": 20},
]
# Frozen baseline of the pre-preferences behavior (both slots → the cheaper-commute emp-1).
_BASELINE_ASSIGNMENT = [("emp-1", "d-mon"), ("emp-1", "d-tue")]


def _bc_problem(*, p=None, preferences=None) -> ProblemInput:
    weights = {"d": 100, "e": 10, "g": 1}
    if p is not None:
        weights["p"] = p
    employees = [_emp("emp-1", preferences=preferences), _emp("emp-2")]
    return _problem(employees, _BC_DEMANDS, _BC_TRAVEL, weights)


def test_backward_compat_no_preferences_no_p_matches_baseline() -> None:
    """No preferences + no weights.p ⇒ the frozen baseline schedule (term omitted entirely)."""
    result = solve(_problem(_BC_EMPLOYEES, _BC_DEMANDS, _BC_TRAVEL, {"d": 100, "e": 10, "g": 1}))
    assert result.status == SolveStatus.OPTIMAL
    assert _canonical(result.assignments) == _BASELINE_ASSIGNMENT
    # Nobody has preferences → every assignment honors vacuously.
    assert result.metrics.preferencesHonoredPct == 1.0


def test_backward_compat_p_zero_identical_to_p_absent() -> None:
    """weights.p == 0 must be bit-identical to weights.p absent (round(0*scale)==0 ⇒ term omitted)."""
    absent = solve(_bc_problem(p=None))
    zero = solve(_bc_problem(p=0.0))
    assert absent.status == zero.status == SolveStatus.OPTIMAL
    assert _canonical(absent.assignments) == _canonical(zero.assignments) == _BASELINE_ASSIGNMENT
    assert absent.metrics.model_dump() == zero.metrics.model_dump()


def test_backward_compat_preferences_present_but_p_absent_is_inert() -> None:
    """Employees CARRYING preferences but p absent ⇒ the preference term is off ⇒ baseline schedule.

    Objective proxy (commute/etat/fairness) is unchanged; only the reported honored-% differs
    because emp-1 now has a preference the (identical) schedule happens to violate.
    """
    baseline = solve(_bc_problem(p=None))
    with_prefs = solve(_bc_problem(p=None, preferences={"preferredDaysOff": ["TUE"]}))
    assert _canonical(with_prefs.assignments) == _canonical(baseline.assignments)
    # Non-preference objective proxy is untouched by carrying (inert) preferences.
    assert with_prefs.metrics.commuteTotal == baseline.metrics.commuteTotal
    assert with_prefs.metrics.etatDeviation == baseline.metrics.etatDeviation
    assert with_prefs.metrics.fairnessScore == baseline.metrics.fairnessScore
    # emp-1 works Mon (ok) + Tue (violates preferredDaysOff=TUE) → 1 of 2 honored.
    assert with_prefs.metrics.preferencesHonoredPct == 0.5


# --- preference honored -------------------------------------------------------------------------
# One Monday KASJER slot; two qualified employees. emp-A commutes cheaper (5 < 10) so WITHOUT a
# preference weight the solver picks emp-A. But emp-A prefers Monday OFF; a high w_p (penalty 50000
# ≫ the 5000 commute edge) flips the pick to emp-B, honoring the preference.

_HONORED_TRAVEL = [
    {"employeeId": "emp-A", "locId": "loc-1", "minutes": 5},
    {"employeeId": "emp-B", "locId": "loc-1", "minutes": 10},
]


def _honored_problem(*, p) -> ProblemInput:
    weights = {"d": 100, "e": 10, "g": 1}
    if p is not None:
        weights["p"] = p
    employees = [
        _emp("emp-A", preferences={"preferredDaysOff": ["MON"]}),
        _emp("emp-B"),
    ]
    return _problem(employees, [_demand("d-mon", "2026-07-06")], _HONORED_TRAVEL, weights)


def test_preference_ignored_without_weight_picks_cheaper_violator() -> None:
    """No w_p ⇒ preferences inert ⇒ solver picks the commute-cheaper emp-A, violating its pref."""
    result = solve(_honored_problem(p=None))
    assert result.status == SolveStatus.OPTIMAL
    assert _canonical(result.assignments) == [("emp-A", "d-mon")]
    # emp-A assigned on its preferred-off Monday → not honored.
    assert result.metrics.preferencesHonoredPct == 0.0


def test_preference_honored_with_high_weight_avoids_violation() -> None:
    """High w_p flips the pick to emp-B (no preference) → the Monday-off preference is honored."""
    result = solve(_honored_problem(p=50))
    assert result.status == SolveStatus.OPTIMAL
    assert _canonical(result.assignments) == [("emp-B", "d-mon")]
    assert result.metrics.preferencesHonoredPct == 1.0


# --- soft, not hard -----------------------------------------------------------------------------
# Sole qualified+available employee for the Monday slot prefers Monday OFF. Coverage (H1) is hard,
# so the slot is STILL filled (feasible), the preference is violated, and honored-% drops below 1.


def test_preference_is_soft_slot_still_covered_when_honoring_impossible() -> None:
    result = solve(
        _honored_problem_single_qualified(),
    )
    # H1 hard → covered, NOT INFEASIBLE, even though the only option violates the preference.
    assert result.status in (SolveStatus.OPTIMAL, SolveStatus.FEASIBLE)
    assert result.unmet == []
    assert _canonical(result.assignments) == [("emp-A", "d-mon")]
    assert result.metrics.preferencesHonoredPct < 1.0
    assert result.metrics.preferencesHonoredPct == 0.0


def _honored_problem_single_qualified() -> ProblemInput:
    # emp-B is MECHANIK-only → cannot cover the KASJER slot; emp-A (prefers MON off) is the sole
    # qualified+available option. High w_p must not turn coverage into a hard preference.
    employees = [
        _emp("emp-A", preferences={"preferredDaysOff": ["MON"]}),
        _emp("emp-B", quals=["MECHANIK"]),
    ]
    return _problem(
        employees,
        [_demand("d-mon", "2026-07-06")],
        _HONORED_TRAVEL,
        {"d": 100, "e": 10, "g": 1, "p": 50},
    )


# --- preferredShiftStart honoring ---------------------------------------------------------------


def test_preferred_shift_start_honored_with_high_weight() -> None:
    """emp-A prefers an 08:00 start; a high w_p steers it onto the 08:00 slot, not the 14:00 one."""
    # Two same-day KASJER slots (different, non-conflicting start times) and two employees; emp-A
    # prefers the 08:00 start. With a high w_p emp-A should land on d-am (08:00), emp-B on d-pm.
    employees = [
        _emp("emp-A", preferences={"preferredShiftStart": ["08:00"]}),
        _emp("emp-B"),
    ]
    demands = [
        _demand("d-am", "2026-07-06", start="08:00", end="12:00"),
        _demand("d-pm", "2026-07-06", start="14:00", end="18:00"),
    ]
    travel = [
        {"employeeId": "emp-A", "locId": "loc-1", "minutes": 10},
        {"employeeId": "emp-B", "locId": "loc-1", "minutes": 10},
    ]
    result = solve(_problem(employees, demands, travel, {"d": 100, "e": 10, "g": 1, "p": 50}))
    assert result.status == SolveStatus.OPTIMAL
    assert result.unmet == []
    # emp-A on its preferred 08:00 start → every assignment honored.
    assert ("emp-A", "d-am") in _canonical(result.assignments)
    assert result.metrics.preferencesHonoredPct == 1.0


# --- determinism --------------------------------------------------------------------------------


def test_determinism_with_preference_weight() -> None:
    first = solve(_honored_problem(p=50))
    second = solve(_honored_problem(p=50))
    assert first.status == second.status == SolveStatus.OPTIMAL
    assert _canonical(first.assignments) == _canonical(second.assignments)
    assert first.metrics.model_dump() == second.metrics.model_dump()
