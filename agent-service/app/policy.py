"""Imitation (behavioural-cloning) scheduling policy with an online feedback update.

This is the **M2 increment** of the self-learning brain, deliberately kept dependency-light (numpy
only — no torch/SB3). The spec's risk table sanctions exactly this minimal viable path: "BC przez
imitation, RL jako warstwa na feedbacku; degradacja do samego BC+forecaster" (§112). The
Gym-shaped RL scaffold lives in :mod:`env` (with the weight-0 manager-acceptance reward seam); this
module is the policy that scaffold serves and that the feedback loop re-fits.

How it learns
-------------
A schedule is built greedily, demand by demand, picking the highest-scoring eligible employees:

    score(e, d) = w · φ(e, d)  +  affinity[(e, slot_signature(d))]

* **φ(e, d)** — fixed cold-start features (commute, etat, fairness/history, qualification
  specificity). These give sensible day-1 behaviour and the raw material for ``/agent/explain``.
* **affinity[(employee, slot_signature)]** — the *learnable* table. ``slot_signature`` is
  ``(role, locId, date, shiftStart)`` — the recurring shape of a slot, NOT its opaque id — so a
  learned preference ("for the KIEROWCA 06:00 slot at loc X, this team prefers employee E") is a
  reusable rule, not memorisation of one demand row.

Cold-start (BC) accumulates affinity from the **solver's** teacher assignments (imitation of #1).
Feedback then moves affinity toward the **manager's** corrections — which a fixed-weight solver can
never do (spec §16). Because affinity persists and each correction reinforces the target slot, the
proposal converges monotonically to the manager-accepted schedule as feedback accumulates: that is
the measurable edit-distance drop of **AG2**.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .contract import Assignment, DemandInput, EmployeeInput, ProblemInput
from .validate import DAILY_REST_MIN, _slot_interval

# Learning rates. Feedback outweighs the solver teacher so a manager correction reliably flips a
# slot within a couple of rounds (adaptation to real preferences over the baseline).
LR_TEACHER = 1.0
LR_FEEDBACK = 3.0

# Fixed cold-start feature weights (φ). Signs encode the soft objective the solver also optimises:
# prefer lower commute, honour etat availability, spread work (fairness), mild specialist bias.
FEATURE_WEIGHTS = {
    "commute": -0.010,   # per minute — lower commute preferred
    "etat": 0.50,        # higher contract fraction slightly preferred for coverage
    "history": -0.004,   # per hour already worked — fairness, spread the load
    "specificity": 0.20,  # 1/len(quals) — mild bias to specialists for their role
}


def slot_signature(d: DemandInput) -> str:
    """The recurring shape of a demand slot — the key the policy learns preferences against."""
    return f"{d.role}|{d.locId}|{d.date}|{d.start}"


@dataclass
class PolicyState:
    """Serializable per-tenant policy: a version number and the learned affinity table."""

    version: int = 1
    affinity: dict[str, float] = field(default_factory=dict)
    #: (proposals_ever, accepted_ever) — feeds the AG5 acceptance metric.
    trained_examples: int = 0

    def to_dict(self) -> dict:
        return {"version": self.version, "affinity": self.affinity, "trained_examples": self.trained_examples}

    @classmethod
    def from_dict(cls, d: dict) -> "PolicyState":
        return cls(
            version=int(d.get("version", 1)),
            affinity=dict(d.get("affinity", {})),
            trained_examples=int(d.get("trained_examples", 0)),
        )


@dataclass
class ScoredCandidate:
    employeeId: str
    score: float
    parts: dict[str, float]


class ImitationPolicy:
    """Stateless-per-call policy driven by an injected :class:`PolicyState`."""

    def __init__(self, state: PolicyState):
        self.state = state

    # --- feature engineering ---------------------------------------------------------------------

    @staticmethod
    def _commute_minutes(problem: ProblemInput, emp_id: str, loc_id: str) -> float:
        for t in problem.travelMatrix:
            if t.employeeId == emp_id and t.locId == loc_id:
                return t.minutes
        return 60.0  # neutral fallback when the matrix omits the pair

    def _features(self, problem: ProblemInput, e: EmployeeInput, d: DemandInput) -> dict[str, float]:
        commute = self._commute_minutes(problem, e.id, d.locId)
        specificity = 1.0 / max(1, len(e.qualifications))
        return {
            "commute": commute,
            "etat": e.etat,
            "history": e.historyHours,
            "specificity": specificity,
        }

    def _base_score(self, feats: dict[str, float]) -> float:
        return sum(FEATURE_WEIGHTS[k] * feats[k] for k in FEATURE_WEIGHTS)

    def score_candidate(self, problem: ProblemInput, e: EmployeeInput, d: DemandInput) -> ScoredCandidate:
        feats = self._features(problem, e, d)
        base = self._base_score(feats)
        aff = self.state.affinity.get(f"{e.id}::{slot_signature(d)}", 0.0)
        parts = {"base": base, "affinity": aff, **{f"f_{k}": v for k, v in feats.items()}}
        return ScoredCandidate(employeeId=e.id, score=base + aff, parts=parts)

    # --- eligibility (H1 qualification, H3 leave) ------------------------------------------------

    @staticmethod
    def _eligible(e: EmployeeInput, d: DemandInput) -> bool:
        return d.role in e.qualifications and d.date not in e.approvedLeaveDates

    # --- proposal (greedy, respects H1/H2/H3/H4) -------------------------------------------------

    def propose(self, problem: ProblemInput) -> tuple[list[Assignment], dict[str, list[ScoredCandidate]]]:
        """Build a schedule greedily; return assignments and the ranked candidates per demand.

        Demands are processed in a stable order (by date, start, locId, id). For each we take the
        top-``count`` eligible employees by score who are not already committed to a slot that would
        violate H2/H4 rest — so the proposal is hard-feasible by construction whenever enough
        eligible staff exist (coverage shortfalls are left to the validator / solver to flag).
        """
        emp_by_id = {e.id: e for e in problem.employees}
        # each employee -> list of (start,end) minute intervals already committed this schedule
        committed: dict[str, list[tuple[int, int]]] = {}
        assignments: list[Assignment] = []
        ranked: dict[str, list[ScoredCandidate]] = {}

        def conflicts(emp_id: str, interval: tuple[int, int]) -> bool:
            s, e = interval
            for cs, ce in committed.get(emp_id, []):
                gap = cs - e if cs >= s else s - ce
                if gap < DAILY_REST_MIN:
                    return True
            return False

        ordered = sorted(problem.demands, key=lambda d: (d.date, d.start, d.locId, d.id))
        for d in ordered:
            interval = _slot_interval(d)
            cands = [
                self.score_candidate(problem, emp_by_id[e.id], d)
                for e in problem.employees
                if self._eligible(e, d)
            ]
            cands.sort(key=lambda c: (-c.score, c.employeeId))
            ranked[d.id] = cands
            picked = 0
            for c in cands:
                if picked >= d.count:
                    break
                if conflicts(c.employeeId, interval):
                    continue
                assignments.append(Assignment(employeeId=c.employeeId, demandId=d.id))
                committed.setdefault(c.employeeId, []).append(interval)
                picked += 1
        return assignments, ranked

    # --- online learning -------------------------------------------------------------------------

    def apply_teacher_assignments(self, problem: ProblemInput, teacher: list[Assignment]) -> None:
        """Cold-start BC: pull affinity toward a teacher schedule's assignments (solver imitation)."""
        dem_by_id = {d.id: d for d in problem.demands}
        for a in teacher:
            d = dem_by_id.get(a.demandId)
            if d is None:
                continue
            key = f"{a.employeeId}::{slot_signature(d)}"
            self.state.affinity[key] = self.state.affinity.get(key, 0.0) + LR_TEACHER
            self.state.trained_examples += 1

    def apply_feedback_edits(self, problem: ProblemInput, edits: list[dict]) -> int:
        """Move affinity per manager edit. Returns the number of learning updates applied.

        Edit shapes (editType):
          * ``MOVE``   {demandId, fromEmployeeId, toEmployeeId} — reassign a slot.
          * ``SWAP``   {demandId, employeeId, otherDemandId, otherEmployeeId} — exchange two slots.
          * ``REMOVE`` {demandId, employeeId} — drop an assignment.
          * ``ACCEPT`` {demandId, employeeId} — reinforce a kept assignment.
          * ``REJECT`` {demandId, employeeId?} — penalise the whole proposed slot (or one pick).
        """
        dem_by_id = {d.id: d for d in problem.demands}
        updates = 0

        def bump(emp_id: str, demand_id: str, delta: float) -> None:
            nonlocal updates
            d = dem_by_id.get(demand_id)
            if d is None or not emp_id:
                return
            key = f"{emp_id}::{slot_signature(d)}"
            self.state.affinity[key] = self.state.affinity.get(key, 0.0) + delta
            updates += 1

        for e in edits:
            t = e.get("editType")
            if t == "MOVE":
                bump(e.get("toEmployeeId"), e["demandId"], +LR_FEEDBACK)
                bump(e.get("fromEmployeeId"), e["demandId"], -LR_FEEDBACK)
            elif t == "SWAP":
                bump(e.get("otherEmployeeId"), e["demandId"], +LR_FEEDBACK)
                bump(e.get("employeeId"), e["demandId"], -LR_FEEDBACK)
                if e.get("otherDemandId"):
                    bump(e.get("employeeId"), e["otherDemandId"], +LR_FEEDBACK)
                    bump(e.get("otherEmployeeId"), e["otherDemandId"], -LR_FEEDBACK)
            elif t == "REMOVE":
                bump(e.get("employeeId"), e["demandId"], -LR_FEEDBACK)
            elif t == "ACCEPT":
                bump(e.get("employeeId"), e["demandId"], +LR_FEEDBACK * 0.25)
            elif t == "REJECT":
                if e.get("employeeId"):
                    bump(e.get("employeeId"), e["demandId"], -LR_FEEDBACK)
        return updates


# --- reward signal mapping (spec §6 AgentFeedback.rewardSignal) --------------------------------

REWARD_BY_EDIT = {
    "ACCEPT": 1.0,
    "REJECT": -1.0,
    "MOVE": -0.5,   # a correction: the proposal was wrong for this slot
    "SWAP": -0.5,
    "REMOVE": -0.75,
}


def reward_for_edit(edit_type: str) -> float:
    return REWARD_BY_EDIT.get(edit_type, 0.0)
