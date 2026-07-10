"""Local hard-constraint validator — a fast, dependency-free mirror of the solver's H1–H4.

The **authoritative** feasibility guardian is the live CP-SAT solver (``/solve`` via
:mod:`optimizer_client`); ``/agent/heal`` always repairs through it (spec §3/§40, DRY §117). This
module is the cheap pre-check the agent runs on its *own* proposals so ``/agent/propose`` can report
``feasibility`` and ``/agent/heal`` can name *what was wrong* without a solver round-trip per slot.

It re-implements the same hard rules the solver enforces structurally (see
``grafik-optimizer/app/solver.py``):

* **H1 qualification** — ``demand.role ∈ employee.qualifications``.
* **H1 coverage** — exactly ``demand.count`` employees per demand (under → unmet, over → violation).
* **H3 availability** — ``demand.date ∉ employee.approvedLeaveDates``.
* **H2 overlap + H4 daily rest ≥ 11h** — no employee holds two slots less than 11h apart.

A violation list that is empty ⇔ the schedule satisfies every hard rule the solver would.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .contract import Assignment, ProblemInput

#: Minimum rest between two shifts of one employee, in minutes (art. 132 KP → H4). Two slots closer
#: than this conflict — which also subsumes plain overlap (negative gap).
DAILY_REST_MIN = 11 * 60


@dataclass
class Violation:
    """One broken hard rule, in the shape ``/agent/heal.whatWasWrong[]`` returns."""

    code: str  # H1_QUALIFICATION | H1_COVERAGE_UNDER | H1_COVERAGE_OVER | H3_LEAVE | H2H4_REST
    demandId: str
    detail: str
    employeeId: str | None = None


@dataclass
class ValidationReport:
    feasible: bool
    violations: list[Violation] = field(default_factory=list)

    def as_wire(self) -> list[dict]:
        return [
            {
                "code": v.code,
                "demandId": v.demandId,
                "employeeId": v.employeeId,
                "detail": v.detail,
            }
            for v in self.violations
        ]


def _to_minutes(demand_date: str, hhmm: str) -> int:
    """Absolute minute offset of a ``HH:mm`` wall-clock time on ``demand_date`` from an epoch day."""
    d = datetime.strptime(demand_date, "%Y-%m-%d")
    h, m = (int(x) for x in hhmm.split(":"))
    # end < start means the window crosses midnight; roll to next day.
    return (d.toordinal() * 24 * 60) + h * 60 + m


def _slot_interval(demand) -> tuple[int, int]:
    start = _to_minutes(demand.date, demand.start)
    end = _to_minutes(demand.date, demand.end)
    if end <= start:  # crosses midnight
        end += 24 * 60
    return start, end


def validate(problem: ProblemInput, assignments: list[Assignment]) -> ValidationReport:
    """Check ``assignments`` against ``problem`` for every hard constraint the solver enforces."""
    emp_by_id = {e.id: e for e in problem.employees}
    dem_by_id = {d.id: d for d in problem.demands}
    violations: list[Violation] = []

    # Group assignments per demand and per employee.
    per_demand: dict[str, list[str]] = {}
    per_emp: dict[str, list[str]] = {}
    for a in assignments:
        if a.demandId not in dem_by_id:
            violations.append(
                Violation("UNKNOWN_DEMAND", a.demandId, f"assignment references unknown demand {a.demandId}", a.employeeId)
            )
            continue
        per_demand.setdefault(a.demandId, []).append(a.employeeId)
        per_emp.setdefault(a.employeeId, []).append(a.demandId)

    # H1 qualification + H3 availability, per assignment.
    for a in assignments:
        d = dem_by_id.get(a.demandId)
        e = emp_by_id.get(a.employeeId)
        if d is None or e is None:
            if e is None:
                violations.append(
                    Violation("UNKNOWN_EMPLOYEE", a.demandId, f"unknown employee {a.employeeId}", a.employeeId)
                )
            continue
        if d.role not in e.qualifications:
            violations.append(
                Violation("H1_QUALIFICATION", d.id, f"{a.employeeId} lacks role {d.role}", a.employeeId)
            )
        if d.date in e.approvedLeaveDates:
            violations.append(
                Violation("H3_LEAVE", d.id, f"{a.employeeId} on approved leave {d.date}", a.employeeId)
            )

    # H1 coverage — exactly demand.count per demand.
    for d in problem.demands:
        got = len(per_demand.get(d.id, []))
        if got < d.count:
            violations.append(
                Violation("H1_COVERAGE_UNDER", d.id, f"demand {d.id} needs {d.count}, has {got}")
            )
        elif got > d.count:
            violations.append(
                Violation("H1_COVERAGE_OVER", d.id, f"demand {d.id} needs {d.count}, has {got}")
            )

    # H2 overlap + H4 daily rest — per employee, pairwise on their slots.
    for emp_id, demand_ids in per_emp.items():
        intervals = []
        for did in demand_ids:
            d = dem_by_id.get(did)
            if d is not None:
                intervals.append((did, *_slot_interval(d)))
        for i in range(len(intervals)):
            for j in range(i + 1, len(intervals)):
                di, si, ei = intervals[i]
                dj, sj, ej = intervals[j]
                # gap between the two slots (in minutes); negative when they overlap.
                gap = sj - ei if sj >= si else si - ej
                if gap < DAILY_REST_MIN:
                    violations.append(
                        Violation(
                            "H2H4_REST",
                            di,
                            f"{emp_id} slots {di}/{dj} rest {gap}min < {DAILY_REST_MIN}min",
                            emp_id,
                        )
                    )

    return ValidationReport(feasible=len(violations) == 0, violations=violations)
