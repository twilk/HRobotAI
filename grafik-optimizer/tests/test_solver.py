"""G1–G4 acceptance tests for the CP-SAT solver (spec #1 §10) — synthetic data only (RODO).

Fixtures are one week × a small region, sized so OPTIMAL is reachable inside the time limit.

  G1 — feasible schedule with 0 hard-constraint (H1–H4) violations, re-checked independently.
  G2 — metrics (commuteTotal, etatDeviation, fairnessScore) populated in SolveResult.
  G3 — determinism: same input solved twice → identical objective *and* canonical assignment.
  G4 — an unsatisfiable input returns INFEASIBLE + non-empty unmet[], not an exception.

The H1–H4 re-checkers below are deliberately reimplemented from the raw contract (not imported
from the solver) so the assertions validate the returned schedule, not the solver's own helpers.
"""

from __future__ import annotations

from datetime import date, datetime

from app.contract import ProblemInput, SolveStatus
from app.solver import solve

# --- synthetic fixtures -------------------------------------------------------------------------

WEEK_START = "2026-07-06"  # Monday

_LOCATIONS = [
    {"id": "loc-1", "latLng": {"lat": 52.2300, "lng": 21.0100}},
    {"id": "loc-2", "latLng": {"lat": 52.4000, "lng": 21.1000}},
]

_EMPLOYEES = [
    {
        "id": "emp-1",
        "qualifications": ["KASJER"],
        "etat": 1.0,
        "homeLatLng": {"lat": 52.2400, "lng": 21.0200},
        "approvedLeaveDates": [],
        "historyHours": 160,
    },
    {
        "id": "emp-2",
        "qualifications": ["KASJER", "MECHANIK"],
        "etat": 1.0,
        "homeLatLng": {"lat": 52.3900, "lng": 21.0900},
        "approvedLeaveDates": ["2026-07-08"],  # on leave Wednesday → H3
        "historyHours": 150,
    },
    {
        "id": "emp-3",
        "qualifications": ["MECHANIK"],
        "etat": 0.5,
        "homeLatLng": None,  # no coords → commute fallback yields unknown (0)
        "approvedLeaveDates": [],
        "historyHours": 80,
    },
]

_DEMANDS = [
    # Monday needs two overlapping KASJER slots → must be two different employees (H2).
    {"id": "d-mon-k1", "locId": "loc-1", "date": "2026-07-06", "start": "08:00", "end": "16:00", "role": "KASJER", "count": 1},
    {"id": "d-mon-k2", "locId": "loc-1", "date": "2026-07-06", "start": "12:00", "end": "20:00", "role": "KASJER", "count": 1},
    # Tuesday: one KASJER + one MECHANIK.
    {"id": "d-tue-k", "locId": "loc-1", "date": "2026-07-07", "start": "08:00", "end": "16:00", "role": "KASJER", "count": 1},
    {"id": "d-tue-m", "locId": "loc-2", "date": "2026-07-07", "start": "09:00", "end": "17:00", "role": "MECHANIK", "count": 1},
    # Wednesday MECHANIK: emp-2 is on leave → only emp-3 can cover (H3).
    {"id": "d-wed-m", "locId": "loc-2", "date": "2026-07-08", "start": "09:00", "end": "17:00", "role": "MECHANIK", "count": 1},
]

_TRAVEL = [
    {"employeeId": "emp-1", "locId": "loc-1", "minutes": 10},
    {"employeeId": "emp-1", "locId": "loc-2", "minutes": 35},
    {"employeeId": "emp-2", "locId": "loc-1", "minutes": 30},
    {"employeeId": "emp-2", "locId": "loc-2", "minutes": 8},
    # emp-3 entries omitted on purpose → provider falls back (emp-3 has no coords → unknown/0).
]

_WEIGHTS = {"d": 100, "e": 10, "g": 1}


def _problem(**overrides) -> ProblemInput:
    payload = {
        "horizon": {"weekStart": WEEK_START},
        "locations": _LOCATIONS,
        "employees": _EMPLOYEES,
        "demands": _DEMANDS,
        "travelMatrix": _TRAVEL,
        "weights": _WEIGHTS,
        "solverConfig": {"seed": 7, "timeLimit": 30},
    }
    payload.update(overrides)
    return ProblemInput(**payload)


def feasible_problem() -> ProblemInput:
    return _problem()


def infeasible_problem() -> ProblemInput:
    """Add a demand for a role nobody is qualified for → cannot satisfy H1."""
    demands = _DEMANDS + [
        {"id": "d-impossible", "locId": "loc-1", "date": "2026-07-09", "start": "08:00", "end": "16:00", "role": "PILOT", "count": 1}
    ]
    return _problem(demands=demands)


# --- independent H1–H4 re-checkers (from raw contract) ------------------------------------------


def _abs_window(week_start: date, d) -> tuple[int, int]:
    day = (date.fromisoformat(d.date) - week_start).days
    t_start = datetime.strptime(d.start, "%H:%M")
    t_end = datetime.strptime(d.end, "%H:%M")
    start = day * 1440 + t_start.hour * 60 + t_start.minute
    end = day * 1440 + t_end.hour * 60 + t_end.minute
    if end <= start:
        end += 1440
    return start, end


def hard_violations(problem: ProblemInput, assignments) -> list[str]:
    """Return a list of H1–H4 violations found in ``assignments`` (empty == clean)."""
    violations: list[str] = []
    week_start = date.fromisoformat(problem.horizon.weekStart)
    by_id = {d.id: d for d in problem.demands}
    emp_by_id = {e.id: e for e in problem.employees}
    windows = {d.id: _abs_window(week_start, d) for d in problem.demands}

    # H1 coverage + qualification, H3 availability.
    per_demand: dict[str, list[str]] = {d.id: [] for d in problem.demands}
    for a in assignments:
        per_demand.setdefault(a.demandId, []).append(a.employeeId)
    for d in problem.demands:
        assigned = per_demand[d.id]
        if len(assigned) != d.count:
            violations.append(f"H1 coverage: {d.id} has {len(assigned)} != count {d.count}")
        if len(set(assigned)) != len(assigned):
            violations.append(f"H1 duplicate employee on {d.id}")
        for e_id in assigned:
            e = emp_by_id[e_id]
            if d.role not in e.qualifications:
                violations.append(f"H1 qualification: {e_id} not qualified for {d.role} ({d.id})")
            if d.date in e.approvedLeaveDates:
                violations.append(f"H3 availability: {e_id} on leave {d.date} but assigned {d.id}")

    # H2 overlap + H4 daily rest ≥ 11h — no same-employee pair closer than 11h.
    per_emp: dict[str, list[str]] = {}
    for a in assignments:
        per_emp.setdefault(a.employeeId, []).append(a.demandId)
    for e_id, demand_ids in per_emp.items():
        for i in range(len(demand_ids)):
            for j in range(i + 1, len(demand_ids)):
                a_s, a_e = windows[demand_ids[i]]
                b_s, b_e = windows[demand_ids[j]]
                if (b_s - a_e < 11 * 60) and (a_s - b_e < 11 * 60):
                    violations.append(
                        f"H2/H4: {e_id} assigned conflicting {demand_ids[i]} & {demand_ids[j]}"
                    )
    return violations


# --- G1 -----------------------------------------------------------------------------------------


def test_g1_feasible_zero_hard_violations() -> None:
    result = solve(feasible_problem())
    assert result.status in (SolveStatus.OPTIMAL, SolveStatus.FEASIBLE)
    assert result.unmet == []
    violations = hard_violations(feasible_problem(), result.assignments)
    assert violations == [], f"hard-constraint violations: {violations}"
    # Sanity: every demand fully covered.
    assert len(result.assignments) == sum(d.count for d in feasible_problem().demands)


# --- G2 -----------------------------------------------------------------------------------------


def test_g2_metrics_populated() -> None:
    result = solve(feasible_problem())
    m = result.metrics
    # All three metric fields present and numeric.
    assert isinstance(m.commuteTotal, float)
    assert isinstance(m.etatDeviation, float)
    assert isinstance(m.fairnessScore, float)
    # Commute is the sum of real per-assignment minutes → strictly positive here.
    assert m.commuteTotal > 0
    # etatDeviation is a non-negative L1 sum.
    assert m.etatDeviation >= 0
    # fairnessScore is a deferred placeholder (M3) → stable 0.0.
    assert m.fairnessScore == 0.0


# --- G3 -----------------------------------------------------------------------------------------


def test_g3_determinism_optimal() -> None:
    first = solve(feasible_problem())
    second = solve(feasible_problem())
    # Determinism is only asserted at OPTIMAL (spec §229-§230).
    assert first.status == SolveStatus.OPTIMAL
    assert second.status == SolveStatus.OPTIMAL

    def canonical(assignments):
        return sorted((a.employeeId, a.demandId) for a in assignments)

    assert canonical(first.assignments) == canonical(second.assignments)
    # Metrics derive from the assignment → identical too (proxy for identical objective value).
    assert first.metrics.model_dump() == second.metrics.model_dump()


# --- G4 -----------------------------------------------------------------------------------------


def test_g4_infeasible_reports_unmet() -> None:
    result = solve(infeasible_problem())  # must not raise
    assert result.status == SolveStatus.INFEASIBLE
    assert len(result.unmet) >= 1
    unmet_ids = {u.demandId for u in result.unmet}
    assert "d-impossible" in unmet_ids
    # Reasons are human-readable, non-empty strings.
    for u in result.unmet:
        assert isinstance(u.reason, str) and u.reason.strip()
