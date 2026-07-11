"""CP-SAT solver for the weekly staffing grafik (M2-A2).

Consumes a frozen :class:`ProblemInput` and produces a frozen :class:`SolveResult` — see
``contract.py`` / the Zod twin in ``packages/shared/src/grafik/contract.ts``. No contract field is
renamed, removed or retyped here.

Model (spec #1 §5, with the adopted M2 scope corrections)
---------------------------------------------------------
Decision vars ``x[e, d] ∈ {0,1}`` — employee ``e`` covers demand slot ``d``. A variable is only
created when ``e`` is *eligible* for ``d``: ``d.role ∈ e.qualifications`` (H1 qualification) **and**
``d.date ∉ e.approvedLeaveDates`` (H3 availability). A non-existent var is an implicit 0, so H1's
role restriction and H3 are enforced structurally.

Hard constraints:
  * **H1 coverage** — ``Σ_e x[e,d] = d.count`` over eligible ``e``.
  * **H2 no overlap** + **H4 daily rest ≥ 11h** — a single pairwise *conflict* relation over
    demands: two slots conflict when the time between them is < 11h (this subsumes overlap, whose
    gap is negative). For every employee eligible for both, ``x[e,d1] + x[e,d2] ≤ 1``.
  * **H3 availability** — baked into variable eligibility (above).

Soft (objective, minimised): ``w_d·unmet + w_e·etatL1 + w_g·commute + w_p·prefViolations`` plus an
internal H5 proxy.
  * **etat L1** — ``Σ_e |workedMinutes(e) − etat·40·60|`` via two ``dev[e] ≥ ±(...)`` inequalities.
  * **commute** — ``Σ x[e,d]·commuteMinutes(e, d.locId)`` from :class:`MatrixWithHaversineFallback`.
  * **preferences (w_p)** — SOFT employee preferences (spec: employee-preferences phase 2). Each
    ``x[e,d]`` whose assignment would VIOLATE a preference of ``e`` contributes ``w_p·violations``
    (``violations`` ∈ {0,1,2}: preferred-day-off hit + non-preferred shift start). Weight is
    ``round(weights.p · _WEIGHT_SCALE)`` when ``weights.p`` is set, else 0 — an absent/None ``p``
    OMITS the term entirely, so a preference-unaware caller gets a bit-identical schedule. This only
    nudges the solver; coverage (H1) and H1–H4 stay hard, so a preference is NEVER guaranteed.
  * **H5 → soft proxy** — penalise, per employee, worked-days above ``7 − MIN_FREE_DAYS_PER_WEEK``.
    A 1-week horizon cannot model rolling 35h rest, so this is a nudge, not a hard rule.
  * **fairness-variance** is DEFERRED to M3; ``metrics.fairnessScore`` is emitted as a stable 0.0.

Feasibility / status (spec #1 §5 — no silent failure):
  Phase 1 solves with **hard** coverage. OPTIMAL/FEASIBLE → return that schedule. If phase 1 is
  INFEASIBLE/UNKNOWN (H1–H4 cannot all hold), phase 2 re-solves with coverage *relaxed* (slack per
  demand) maximising coverage, and we return ``status = INFEASIBLE`` with ``unmet[]`` naming every
  slot left uncovered + a human-readable reason. CP-SAT status maps: OPTIMAL→OPTIMAL,
  FEASIBLE→FEASIBLE, INFEASIBLE/unknown-no-solution→INFEASIBLE.

Determinism (spec #1 §5, correction §229-§230):
  ``num_search_workers=1`` + ``random_seed = solverConfig.seed`` + ``max_time_in_seconds =
  solverConfig.timeLimit``. The model is built in stable input order. Reproducibility is asserted
  only at OPTIMAL — not promised bit-identical under a hit time-limit / FEASIBLE.
"""

from __future__ import annotations

from datetime import date, datetime

from ortools.sat.python import cp_model

from .commute import MatrixWithHaversineFallback
from .contract import (
    Assignment,
    DemandInput,
    EmployeeInput,
    Metrics,
    ProblemInput,
    SolveResult,
    SolveStatus,
    Unmet,
)

#: Minimum daily rest between two shifts of the same employee, in minutes (art. 132 KP → H4).
_DAILY_REST_MIN = 11 * 60

#: H5 soft proxy: target free days per employee in the 1-week horizon.
MIN_FREE_DAYS_PER_WEEK = 2

#: Minutes-equivalent penalty per missing free day below :data:`MIN_FREE_DAYS_PER_WEEK`. Modest so
#: it only breaks ties among H1–H4-feasible schedules; tunable in UAT. Not a contract field.
H5_FREE_DAY_PENALTY_MIN = 60

#: Days in the planning horizon (Mon–Sun).
_HORIZON_DAYS = 7

#: Float weights → integer objective coefficients (CP-SAT is integer-linear). A fixed scale keeps
#: results deterministic; metrics are reported from the raw assignment, not this scaled objective.
_WEIGHT_SCALE = 1000


def _parse_time_min(hhmm: str) -> int:
    """``"HH:mm"`` → minutes since midnight."""
    t = datetime.strptime(hhmm, "%H:%M")
    return t.hour * 60 + t.minute


def _abs_window(week_start: date, d: DemandInput) -> tuple[int, int]:
    """Absolute [start, end) of a demand in minutes from ``week_start`` 00:00.

    An ``end <= start`` window is treated as crossing midnight (``end += 24h``) so overnight shifts
    still get correct overlap/rest arithmetic.
    """
    day_offset = (date.fromisoformat(d.date) - week_start).days
    start = day_offset * 1440 + _parse_time_min(d.start)
    end = day_offset * 1440 + _parse_time_min(d.end)
    if end <= start:
        end += 1440
    return start, end


def _conflict(a: tuple[int, int], b: tuple[int, int]) -> bool:
    """True when two absolute windows are closer than 11h apart (subsumes overlap → H2 ∪ H4)."""
    (a_start, a_end), (b_start, b_end) = a, b
    return (b_start - a_end < _DAILY_REST_MIN) and (a_start - b_end < _DAILY_REST_MIN)


#: Weekday codes indexed by ``date.weekday()`` (Mon=0..Sun=6), matching ``preferredDaysOff`` codes.
_WEEKDAY_CODES = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def _pref_violations(emp: EmployeeInput, d: DemandInput) -> int:
    """Number of soft preferences (0, 1, or 2) that assigning ``emp`` to ``d`` would VIOLATE.

    * preferredDaysOff — the demand's weekday code is in the employee's preferred-off set.
    * preferredShiftStart — the set is non-empty AND the demand start time is not in it.

    An employee with no preferences (or empty sub-lists) never violates → returns 0.
    """
    prefs = emp.preferences
    if prefs is None:
        return 0
    count = 0
    days_off = prefs.preferredDaysOff or ()
    if days_off and _WEEKDAY_CODES[date.fromisoformat(d.date).weekday()] in days_off:
        count += 1
    starts = prefs.preferredShiftStart or ()
    if starts and d.start not in starts:
        count += 1
    return count


def solve(problem: ProblemInput) -> SolveResult:
    """Run the CP-SAT model and return a frozen :class:`SolveResult`."""
    week_start = date.fromisoformat(problem.horizon.weekStart)
    employees = problem.employees
    demands = problem.demands

    # Precompute per-demand absolute windows, durations, and day index within the horizon.
    windows = {d.id: _abs_window(week_start, d) for d in demands}
    duration_min = {d.id: windows[d.id][1] - windows[d.id][0] for d in demands}
    day_index = {
        d.id: max(0, min(_HORIZON_DAYS - 1, (date.fromisoformat(d.date) - week_start).days))
        for d in demands
    }
    leave = {e.id: set(e.approvedLeaveDates) for e in employees}

    # Eligibility: qualified for the role (H1) AND not on approved leave that date (H3).
    def eligible(e_qual: set[str], e_id: str, d: DemandInput) -> bool:
        return d.role in e_qual and d.date not in leave[e_id]

    quals = {e.id: set(e.qualifications) for e in employees}
    # eligible_e[d.id] -> ordered list of employee ids that may cover demand d (stable input order).
    eligible_e: dict[str, list[str]] = {
        d.id: [e.id for e in employees if eligible(quals[e.id], e.id, d)] for d in demands
    }

    # Pairwise demand conflicts (H2 ∪ H4), computed once over stable input order.
    conflict_pairs: list[tuple[str, str]] = []
    for i in range(len(demands)):
        for j in range(i + 1, len(demands)):
            di, dj = demands[i], demands[j]
            if _conflict(windows[di.id], windows[dj.id]):
                conflict_pairs.append((di.id, dj.id))

    commute = MatrixWithHaversineFallback(problem.travelMatrix, employees, problem.locations)

    result = _solve_phase(
        problem,
        eligible_e,
        conflict_pairs,
        duration_min,
        day_index,
        commute,
        relax_coverage=False,
    )
    if result is not None:
        return result

    # Phase 1 infeasible → relax coverage to report *which* slots are uncoverable (never silent).
    return _solve_phase(
        problem,
        eligible_e,
        conflict_pairs,
        duration_min,
        day_index,
        commute,
        relax_coverage=True,
    )


def _solve_phase(
    problem: ProblemInput,
    eligible_e: dict[str, list[str]],
    conflict_pairs: list[tuple[str, str]],
    duration_min: dict[str, int],
    day_index: dict[str, int],
    commute: MatrixWithHaversineFallback,
    relax_coverage: bool,
) -> SolveResult | None:
    """Build & solve one phase.

    ``relax_coverage=False`` (phase 1): hard coverage. Returns a :class:`SolveResult` on
    OPTIMAL/FEASIBLE, or ``None`` when CP-SAT cannot satisfy H1–H4 (caller then runs phase 2).
    ``relax_coverage=True`` (phase 2): soft coverage slack, maximise coverage, always returns an
    INFEASIBLE result listing the uncovered slots.
    """
    model = cp_model.CpModel()
    employees = problem.employees
    demands = problem.demands
    weights = problem.weights

    # x[e, d] for eligible pairs only (stable order: demand then employee).
    x: dict[tuple[str, str], cp_model.IntVar] = {}
    for d in demands:
        for e_id in eligible_e[d.id]:
            x[(e_id, d.id)] = model.NewBoolVar(f"x_{e_id}_{d.id}")

    # H1 coverage.
    unmet_var: dict[str, cp_model.IntVar] = {}
    for d in demands:
        covering = [x[(e_id, d.id)] for e_id in eligible_e[d.id]]
        if relax_coverage:
            slack = model.NewIntVar(0, d.count, f"unmet_{d.id}")
            unmet_var[d.id] = slack
            model.Add(sum(covering) + slack == d.count)
        else:
            model.Add(sum(covering) == d.count)

    # H2 ∪ H4: at most one of a conflicting pair per employee.
    x_by_demand: dict[str, set[str]] = {d.id: set(eligible_e[d.id]) for d in demands}
    for d1, d2 in conflict_pairs:
        for e_id in x_by_demand[d1] & x_by_demand[d2]:
            model.Add(x[(e_id, d1)] + x[(e_id, d2)] <= 1)

    # Phase 2 (relaxed): pure max-coverage diagnostic — minimise total unmet only, so the reported
    # unmet[] is the TRUE uncoverable set independent of the caller's weights (a low w_d must not
    # let the solver choose to skip coverable slots). Secondary costs are irrelevant here.
    if relax_coverage:
        model.Minimize(sum(unmet_var[d.id] for d in demands))
        return _finish_phase(model, problem, x, unmet_var, eligible_e, commute, relax_coverage=True)

    obj_terms: list[cp_model.LinearExpr] = []

    # Objective — etat L1 deviation (w_e), in minutes.
    w_e = round(weights.e * _WEIGHT_SCALE)
    for e in employees:
        assigned = [
            duration_min[d.id] * x[(e.id, d.id)] for d in demands if (e.id, d.id) in x
        ]
        target_min = round(e.etat * 40 * 60)
        max_worked = sum(duration_min[d.id] for d in demands if (e.id, d.id) in x)
        worked = model.NewIntVar(0, max_worked, f"worked_{e.id}")
        model.Add(worked == sum(assigned) if assigned else worked == 0)
        dev = model.NewIntVar(0, max(target_min, max_worked), f"dev_{e.id}")
        model.Add(dev >= worked - target_min)
        model.Add(dev >= target_min - worked)
        if w_e:
            obj_terms.append(w_e * dev)

    # Objective — commute (w_g). Integer minutes per assignment; unknown commute → 0.
    w_g = round(weights.g * _WEIGHT_SCALE)
    if w_g:
        demand_loc = {d.id: d.locId for d in demands}
        for (e_id, d_id), var in x.items():
            minutes = commute.minutes(e_id, demand_loc[d_id])
            if minutes:
                obj_terms.append(w_g * round(minutes) * var)

    # Objective — soft employee preferences (w_p). Each eligible assignment that would violate a
    # preference of the employee contributes w_p·(violations). SOFT only: absent/None p ⇒ w_p == 0
    # ⇒ term omitted ⇒ schedule identical to a preference-unaware run. Build order = x insertion
    # order (demand then employee), same as commute, so the objective stays deterministic.
    w_p = round(weights.p * _WEIGHT_SCALE) if weights.p is not None else 0
    if w_p:
        emp_by_id = {e.id: e for e in employees}
        demand_by_id = {d.id: d for d in demands}
        for (e_id, d_id), var in x.items():
            violations = _pref_violations(emp_by_id[e_id], demand_by_id[d_id])
            if violations:
                obj_terms.append(w_p * violations * var)

    # Objective — H5 soft proxy: penalise worked-days beyond (7 - N) per employee.
    max_worked_days = _HORIZON_DAYS - MIN_FREE_DAYS_PER_WEEK
    h5_coef = round(H5_FREE_DAY_PENALTY_MIN * _WEIGHT_SCALE)
    for e in employees:
        worked_day_vars = []
        for day in range(_HORIZON_DAYS):
            day_slots = [
                x[(e.id, d.id)] for d in demands if (e.id, d.id) in x and day_index[d.id] == day
            ]
            if not day_slots:
                continue
            wd = model.NewBoolVar(f"wd_{e.id}_{day}")
            for slot in day_slots:
                model.Add(wd >= slot)
            worked_day_vars.append(wd)
        if not worked_day_vars:
            continue
        shortfall = model.NewIntVar(0, _HORIZON_DAYS, f"h5short_{e.id}")
        model.Add(shortfall >= sum(worked_day_vars) - max_worked_days)
        obj_terms.append(h5_coef * shortfall)

    model.Minimize(sum(obj_terms) if obj_terms else 0)
    return _finish_phase(model, problem, x, unmet_var, eligible_e, commute, relax_coverage=False)


def _finish_phase(
    model: cp_model.CpModel,
    problem: ProblemInput,
    x: dict[tuple[str, str], cp_model.IntVar],
    unmet_var: dict[str, cp_model.IntVar],
    eligible_e: dict[str, list[str]],
    commute: MatrixWithHaversineFallback,
    relax_coverage: bool,
) -> SolveResult | None:
    """Solve the built model deterministically and shape the SolveResult (or None for phase 1)."""
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = int(problem.solverConfig.seed)
    solver.parameters.max_time_in_seconds = float(problem.solverConfig.timeLimit)
    status = solver.Solve(model)

    has_solution = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    if not relax_coverage:
        if not has_solution:
            return None  # H1–H4 unsatisfiable → caller runs the relaxed phase.
        assignments = _extract_assignments(solver, x)
        metrics = _compute_metrics(problem, assignments, commute)
        result_status = SolveStatus.OPTIMAL if status == cp_model.OPTIMAL else SolveStatus.FEASIBLE
        return SolveResult(status=result_status, assignments=assignments, metrics=metrics, unmet=[])

    # Relaxed phase → always INFEASIBLE, report partial schedule + uncovered slots.
    assignments = _extract_assignments(solver, x) if has_solution else []
    metrics = _compute_metrics(problem, assignments, commute)
    unmet: list[Unmet] = []
    for d in problem.demands:
        shortfall = int(solver.Value(unmet_var[d.id])) if has_solution else d.count
        if shortfall > 0:
            unmet.append(
                Unmet(
                    demandId=d.id,
                    reason=(
                        f"{shortfall} of {d.count} slot(s) for role '{d.role}' at '{d.locId}' on "
                        f"{d.date} {d.start}-{d.end} uncoverable under H1-H4 "
                        f"(qualified & available employees: {len(eligible_e[d.id])})"
                    ),
                )
            )
    if not unmet:
        # Defensive: infeasible with no identifiable slack (should not happen) — never stay silent.
        unmet = [
            Unmet(demandId=d.id, reason="no feasible assignment under H1-H4")
            for d in problem.demands
        ]
    return SolveResult(
        status=SolveStatus.INFEASIBLE, assignments=assignments, metrics=metrics, unmet=unmet
    )


def _extract_assignments(
    solver: cp_model.CpSolver, x: dict[tuple[str, str], cp_model.IntVar]
) -> list[Assignment]:
    """Read x=1 vars into a canonically-sorted assignment list (stable across identical solves)."""
    picked = [
        (e_id, d_id) for (e_id, d_id), var in x.items() if solver.Value(var) == 1
    ]
    picked.sort()
    return [Assignment(employeeId=e_id, demandId=d_id) for e_id, d_id in picked]


def _compute_metrics(
    problem: ProblemInput,
    assignments: list[Assignment],
    commute: MatrixWithHaversineFallback,
) -> Metrics:
    """Metrics read off the returned assignment (not the scaled objective)."""
    week_start = date.fromisoformat(problem.horizon.weekStart)
    demand_loc = {d.id: d.locId for d in problem.demands}
    dur_hours = {}
    for d in problem.demands:
        start, end = _abs_window(week_start, d)
        dur_hours[d.id] = (end - start) / 60.0

    commute_total = 0.0
    worked_hours: dict[str, float] = {e.id: 0.0 for e in problem.employees}
    for a in assignments:
        minutes = commute.minutes(a.employeeId, demand_loc[a.demandId])
        if minutes:
            commute_total += minutes
        worked_hours[a.employeeId] = worked_hours.get(a.employeeId, 0.0) + dur_hours[a.demandId]

    etat_deviation = 0.0
    for e in problem.employees:
        etat_deviation += abs(worked_hours.get(e.id, 0.0) - e.etat * 40.0)

    # preferencesHonoredPct: fraction (0..1) of returned assignments that HONOR the assigned
    # employee's preferences — an assignment honors iff it violates NEITHER preference (day not in
    # preferredDaysOff AND preferredShiftStart empty-or-contains-start). An employee with no
    # preferences honors vacuously. With 0 assignments there is nothing to dishonor → emit 1.0.
    total_assignments = len(assignments)
    if total_assignments == 0:
        preferences_honored_pct = 1.0
    else:
        emp_by_id = {e.id: e for e in problem.employees}
        demand_by_id = {d.id: d for d in problem.demands}
        honored = sum(
            1
            for a in assignments
            if _pref_violations(emp_by_id[a.employeeId], demand_by_id[a.demandId]) == 0
        )
        preferences_honored_pct = round(honored / total_assignments, 6)

    # fairnessScore: reserved placeholder — fairness-variance is DEFERRED to M3. Emit stable 0.0.
    return Metrics(
        commuteTotal=round(commute_total, 6),
        etatDeviation=round(etat_deviation, 6),
        fairnessScore=0.0,
        preferencesHonoredPct=preferences_honored_pct,
    )
