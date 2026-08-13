"""HON-2 controls — the evidence behind the honest framing of AG2.

Three questions the M2 evidence pack should be able to answer without hand-waving:

* **C1 — was the original AG2 reference reachable by construction?** Yes. It is produced by the
  agent's own ``ImitationPolicy.propose``, and the agent can reproduce it exactly.
* **C2 — how far does the agent get against a manager it had no hand in defining?** All the way to
  edit-distance 0, but from a much larger day-1 gap and over materially more rounds. Six arbitrary
  managers (different ``taste_salt``) are measured, not one.
* **C3 — does what it learned transfer to the next week?** No. The affinity key contains the date,
  so a date-shifted week starts from scratch.

Run from the service root (no server needed — this drives the service layer in-process):

    python -m demo.hon2_controls        # or: python demo/hon2_controls.py

Output is committed at ``evidence/hon2_controls_run.txt``.
"""

from __future__ import annotations

import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import demo_ag2  # noqa: E402
from app.contract import Assignment, ProblemInput  # noqa: E402
from app.demo_ag2 import _edits_toward, manager_accepted_schedule, run_demo  # noqa: E402
from app.fixtures import canonical_problem  # noqa: E402
from app.manager_profile import ManagerProfile, independent_manager_schedule  # noqa: E402
from app.metrics import edit_distance  # noqa: E402
from app.policy import ImitationPolicy, PolicyState, slot_signature  # noqa: E402
from app.service import AgentService  # noqa: E402
from app.store import AgentStore  # noqa: E402
from app.validate import validate  # noqa: E402


def _drive(problem, accepted, rounds, budget, use_feedback, tenant) -> list[int]:
    """Run the AG2 loop against an arbitrary reference schedule; return the edit-distance curve."""
    service = AgentService(AgentStore(":memory:"))
    curve: list[int] = []
    for _ in range(rounds):
        prop = service.propose(tenant, problem)
        proposed = [Assignment.model_validate(a) for a in prop["assignments"]]
        curve.append(edit_distance(proposed, accepted))
        if use_feedback:
            edits = _edits_toward(proposed, accepted, problem, budget)
            if edits:
                service.feedback(tenant, prop["proposalId"], edits, accepted=False)
    return curve


def control_1_by_construction(problem) -> None:
    print("=" * 96)
    print("C1 — is the ORIGINAL AG2 reference reachable by construction?")
    print("=" * 96)
    accepted = manager_accepted_schedule(problem)
    report = validate(problem, accepted)
    print("  reference built by         : app.policy.ImitationPolicy.propose  (demo_ag2.py)")
    print(f"  |reference|                : {len(accepted)}   hard-feasible={report.feasible}")

    # Load the agent's own affinity table with the reference pairs and re-propose: distance 0 means
    # the target sits inside the policy's hypothesis class, by construction.
    state = PolicyState(version=0)
    policy = ImitationPolicy(state)
    dem_by_id = {d.id: d for d in problem.demands}
    for a in accepted:
        state.affinity[f"{a.employeeId}::{slot_signature(dem_by_id[a.demandId])}"] = 1000.0
    reproduced, _ = policy.propose(problem)
    print(f"  agent reproduces it exactly: edit_distance={edit_distance(reproduced, accepted)}")

    print("  baseline curve (budget 6)  :", [h["editDistance"] for h in run_demo(rounds=6)["history"]])

    # If convergence were purely an artifact of the construction, ANY preference fed through the
    # same builder would converge just as fast. It does not — so the construction is a real
    # methodological weakness, but not the whole story.
    print("  same builder, random preference instead of etat-priority (6 rounds, budget 6):")
    for seed in (1, 2, 3):
        rng = random.Random(seed)
        favors: dict[str, float] = {}

        def garbage(emp, _rng=rng, _f=favors):
            if emp.id not in _f:
                _f[emp.id] = _rng.uniform(-50.0, 50.0)
            return _f[emp.id]

        original = demo_ag2._manager_favor
        demo_ag2._manager_favor = garbage
        try:
            curve = [h["editDistance"] for h in run_demo(rounds=6)["history"]]
        finally:
            demo_ag2._manager_favor = original
        print(f"    seed={seed}: {curve}")


def control_2_independent(problem) -> None:
    print()
    print("=" * 96)
    print("C2 — six arbitrary INDEPENDENTLY defined managers (20 rounds, budget 6)")
    print("=" * 96)
    for salt in ("", "m2", "kowalski", "nowak", "4mobility", "zz9"):
        profile = ManagerProfile(taste_salt=salt)
        accepted = independent_manager_schedule(problem, profile)
        report = validate(problem, accepted)
        curve = _drive(problem, accepted, 20, 6, True, f"c2-{salt or 'default'}")
        flat = _drive(problem, accepted, 4, 6, False, f"c2n-{salt or 'default'}")
        first_zero = curve.index(0) if 0 in curve else None
        print(f"  salt={salt or '(default)':<11} |A|={len(accepted)} feasible={report.feasible} "
              f"day1={curve[0]} firstZeroRound={first_zero} "
              f"monotone={all(b <= a for a, b in zip(curve, curve[1:]))} "
              f"ablationFlat={len(set(flat)) == 1}")
        print(f"    curve: {curve}")


def _shift_week(problem: ProblemInput, days: int) -> ProblemInput:
    raw = problem.model_dump()
    raw["horizon"]["weekStart"] = (
        date.fromisoformat(raw["horizon"]["weekStart"]) + timedelta(days=days)
    ).isoformat()
    for d in raw["demands"]:
        d["date"] = (date.fromisoformat(d["date"]) + timedelta(days=days)).isoformat()
    for e in raw["employees"]:
        e["approvedLeaveDates"] = [
            (date.fromisoformat(x) + timedelta(days=days)).isoformat()
            for x in e["approvedLeaveDates"]
        ]
    return ProblemInput.model_validate(raw)


def control_3_transfer(problem) -> None:
    print()
    print("=" * 96)
    print("C3 — does the learned preference transfer to the NEXT week?")
    print("=" * 96)
    profile = ManagerProfile()
    accepted = independent_manager_schedule(problem, profile)

    service = AgentService(AgentStore(":memory:"))
    curve: list[int] = []
    for _ in range(20):
        prop = service.propose("c3", problem)
        proposed = [Assignment.model_validate(a) for a in prop["assignments"]]
        curve.append(edit_distance(proposed, accepted))
        edits = _edits_toward(proposed, accepted, problem, 6)
        if edits:
            service.feedback("c3", prop["proposalId"], edits, accepted=False)
    print(f"  week 1 training curve      : {curve}")

    nextweek = _shift_week(problem, 7)
    accepted_next = independent_manager_schedule(nextweek, profile)
    trained = [Assignment.model_validate(a) for a in service.propose("c3", nextweek)["assignments"]]
    cold_service = AgentService(AgentStore(":memory:"))
    cold = [Assignment.model_validate(a) for a in cold_service.propose("cold", nextweek)["assignments"]]

    d_trained = edit_distance(trained, accepted_next)
    d_cold = edit_distance(cold, accepted_next)
    same = {(a.employeeId, a.demandId) for a in trained} == {(a.employeeId, a.demandId) for a in cold}
    print(f"  week 2 (dates +7d), |A|={len(accepted_next)}")
    print(f"    cold-start agent vs manager : {d_cold}")
    print(f"    TRAINED  agent  vs manager  : {d_trained}")
    print(f"    transfer gain               : {d_cold - d_trained}")
    print(f"    trained proposal == cold-start proposal? {same}")
    print("  -> slot_signature = (role, locId, DATE, start): every learned key misses next week.")


def main() -> None:
    problem = canonical_problem()
    control_1_by_construction(problem)
    control_2_independent(problem)
    control_3_transfer(problem)


if __name__ == "__main__":
    main()
