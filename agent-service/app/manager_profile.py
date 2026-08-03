"""An **independently defined** manager roster preference — the HON-2 control for AG2.

Why this module exists
----------------------
The original AG2 reference schedule (:func:`app.demo_ag2.manager_accepted_schedule`) is built by
calling the agent's *own* :meth:`app.policy.ImitationPolicy.propose` with a manager-flavoured
affinity table. That makes the target **reachable by construction**: it is drawn from the policy's
own hypothesis class, produced by the very operator the agent uses to propose. Convergence to
edit-distance 0 in that setup is therefore a weak claim — a reviewer can object that the experiment
can hardly come out any other way.

This module defines the manager's preferred roster **without ever calling the agent's policy**. It
never imports :mod:`app.policy`; the only thing it shares with the agent is the problem domain
itself (H1 qualification, H3 leave, H2/H4 rest — the labour-law rules any legal roster must obey,
mirrored from :mod:`app.validate`).

How the independent manager differs structurally from ``propose()``
-------------------------------------------------------------------
================  ==========================================  ====================================
aspect            agent ``ImitationPolicy.propose``            this ``independent_manager_schedule``
================  ==========================================  ====================================
demand order      ``(date, start, locId, id)``                 scarcity first: fewest eligible
                                                               candidates, then ``(date, start, id)``
selection rule    static argmax of ``w·φ + affinity``          **load dependent**: fewest shifts
                                                               assigned so far wins
quota             none                                         weekly shift **cap** per employee
                                                               (soft-relaxed to keep coverage)
preference shape  per ``(employee, slot_signature)`` table     per ``(employee, shift band)``,
                                                               derived from a SHA-256 digest of the
                                                               employee id — deliberately
                                                               uncorrelated with every φ feature
                                                               (commute, etat, history, specificity)
================  ==========================================  ====================================

The result is a legal roster that expresses a coherent, human-plausible policy ("spread the work
evenly, cap everyone's week, and within that follow my personal taste for who works mornings vs
afternoons") which the agent's fixed features do not encode and whose *generator* is a different
kind of algorithm altogether.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .contract import Assignment, DemandInput, EmployeeInput, ProblemInput
from .validate import DAILY_REST_MIN, _slot_interval

#: Wall-clock hour that splits the manager's two shift bands.
BAND_SPLIT_HOUR = 12


def shift_band(d: DemandInput) -> str:
    """``EARLY`` for shifts starting before noon, ``LATE`` otherwise — the manager's own bucketing."""
    return "EARLY" if int(d.start.split(":")[0]) < BAND_SPLIT_HOUR else "LATE"


def manager_taste(employee_id: str, band: str, salt: str = "") -> float:
    """Deterministic per-``(employee, band)`` liking in ``[0, 1)``.

    Derived from a SHA-256 digest, so it is stable, reproducible and — crucially — **statistically
    unrelated to any feature the agent scores on**. A manager who simply likes certain people on
    mornings and others on afternoons, for reasons the feature vector cannot see. ``salt`` selects a
    different, equally arbitrary manager — used to show the AG2 result is not one lucky digest.
    """
    digest = hashlib.sha256(f"{salt}|{employee_id}|{band}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 2**32


@dataclass(frozen=True)
class ManagerProfile:
    """The manager's written-down rostering policy. Nothing here references the agent."""

    #: How many shifts the manager wants any one person to work in the planned week.
    weekly_shift_cap: int = 2
    #: Relax the cap when honouring it would leave a demand uncovered (coverage beats the quota).
    relax_cap_for_coverage: bool = True
    #: Picks which arbitrary manager we are modelling (see :func:`manager_taste`).
    taste_salt: str = ""


def _eligible(e: EmployeeInput, d: DemandInput) -> bool:
    """H1 qualification + H3 approved leave — domain rules, not agent logic."""
    return d.role in e.qualifications and d.date not in e.approvedLeaveDates


def _rest_conflict(committed: list[tuple[int, int]], interval: tuple[int, int]) -> bool:
    """H2 overlap / H4 11h daily rest against the slots this person already holds."""
    s, e = interval
    for cs, ce in committed:
        gap = cs - e if cs >= s else s - ce
        if gap < DAILY_REST_MIN:
            return True
    return False


def independent_manager_schedule(
    problem: ProblemInput, profile: ManagerProfile | None = None
) -> list[Assignment]:
    """Build the roster this manager would write by hand — without the agent's policy.

    Scarcity-first over demands; within a demand, the least-loaded eligible person wins, ties broken
    by the manager's taste for that shift band. The weekly cap is honoured while any capped-in
    candidate remains and relaxed only to avoid leaving a slot uncovered.
    """
    profile = profile or ManagerProfile()
    emp_by_id = {e.id: e for e in problem.employees}

    load: dict[str, int] = {e.id: 0 for e in problem.employees}
    committed: dict[str, list[tuple[int, int]]] = {}
    assignments: list[Assignment] = []

    def eligible_count(d: DemandInput) -> int:
        return sum(1 for e in problem.employees if _eligible(e, d))

    # Scarcity first: the hardest-to-staff slots get the manager's attention before the easy ones.
    ordered = sorted(problem.demands, key=lambda d: (eligible_count(d), d.date, d.start, d.id))

    for d in ordered:
        interval = _slot_interval(d)
        band = shift_band(d)
        pool = [
            e
            for e in problem.employees
            if _eligible(e, d) and not _rest_conflict(committed.get(e.id, []), interval)
        ]
        picked = 0
        used: set[str] = set()
        # Pass 1 honours the cap; pass 2 (only if needed) relaxes it so the slot still gets covered.
        passes = [True, False] if profile.relax_cap_for_coverage else [True]
        for honour_cap in passes:
            if picked >= d.count:
                break
            cands = [
                e
                for e in pool
                if e.id not in used
                and (not honour_cap or load[e.id] < profile.weekly_shift_cap)
            ]
            # Load-dependent ordering: fewest shifts so far, then the manager's taste, then id.
            cands.sort(key=lambda e: (load[e.id], -manager_taste(e.id, band, profile.taste_salt), e.id))
            for e in cands:
                if picked >= d.count:
                    break
                assignments.append(Assignment(employeeId=e.id, demandId=d.id))
                committed.setdefault(e.id, []).append(interval)
                load[e.id] += 1
                used.add(e.id)
                picked += 1

    # Stable output order so artefacts diff cleanly.
    assignments.sort(key=lambda a: (a.demandId, a.employeeId))
    assert all(a.employeeId in emp_by_id for a in assignments)
    return assignments
