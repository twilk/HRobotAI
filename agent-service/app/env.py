"""Gymnasium environment wrapping the FROZEN grafik contract.

Scope (M2-C1 phase B): a minimal-but-real scheduling MDP. Deliberately tabular features — no
learned state embedding yet (that is a later increment). A random-action rollout must run
end-to-end offline; the optimizer seam is opt-in.

MDP shape
---------
* An episode is one ``ProblemInput``. Each demand row of ``count`` C is expanded into C *slots*;
  the agent fills slots left-to-right, one per ``step``.
* Observation (``Box``): tabular features of the *current* slot's demand plus, for each employee
  (padded to ``max_employees``), a compatibility row (qualified / on-leave / already-assigned /
  etat / history / travel-minutes). Padded rows are zero and masked as "not a real employee".
* Action (``Discrete(max_employees + 1)``): pick an employee index to assign to the current slot,
  or the last index = "leave this slot unfilled".
* Reward: a weighted sum of components (``RewardConfig``). Hard-constraint checks (H1 qualify,
  H3 approved-leave, and a no-double-book-in-overlapping-window guard) score badly; a clean local
  assignment scores well; leaving a coverable slot unfilled is penalised. Manager-acceptance and
  soft-goal terms are seams (weight 0 now) for M2-C2/C3. When ``use_optimizer`` is set, the live
  CP-SAT solver adjudicates a terminal feasibility bonus/penalty against the whole proposal.

Nothing about the reward model is meant to be final; it is the loop the later BC + RL work trains
against, kept small enough to read in one sitting.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from .contract import ProblemInput
from .optimizer_client import OptimizerClient

# Per-employee feature width in the observation (keep in sync with ``_employee_features``).
_EMP_FEATURES = 6
# Per-demand-slot feature width (keep in sync with ``_demand_features``).
_DEMAND_FEATURES = 5


@dataclass
class RewardConfig:
    """Weights for the reward components. Tune freely; the seams default to 0 until wired.

    ``feasible`` rewards a hard-constraint-clean assignment. ``hard_violation`` penalises an
    assignment that breaks a hard constraint (qualification / leave / overlap) or names a padded
    (non-existent) employee. ``unfilled`` penalises leaving a slot empty. ``optimizer_feasibility``
    scales the terminal bonus/penalty derived from the live solver (only when ``use_optimizer``).
    ``manager_acceptance`` and ``soft_goal`` are placeholders for M2-C2/C3 signals.
    """

    feasible: float = 1.0
    hard_violation: float = -1.0
    unfilled: float = -0.25
    optimizer_feasibility: float = 1.0
    manager_acceptance: float = 0.0  # seam: manager accept/reject signal (M2-C2)
    soft_goal: float = 0.0  # seam: fairness / commute / etat soft goals (M2-C3)


@dataclass
class _Slot:
    """One unit of demand to fill (a demand row of count C expands to C slots)."""

    demand_index: int
    demand_id: str


@dataclass
class _EpisodeState:
    assignments: list[tuple[str, str]] = field(default_factory=list)  # (employeeId, demandId)
    # employeeId -> list of (date, start_min, end_min) already taken, for overlap detection.
    booked: dict[str, list[tuple[str, int, int]]] = field(default_factory=dict)


def _hhmm_to_minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def _overlaps(a: tuple[str, int, int], b: tuple[str, int, int]) -> bool:
    """True iff two (date, start_min, end_min) windows are the same day and overlap."""
    if a[0] != b[0]:
        return False
    return a[1] < b[2] and b[1] < a[2]


class GrafikSchedulingEnv(gym.Env):
    """A scheduling MDP over one ``ProblemInput``. See module docstring for the contract."""

    metadata = {"render_modes": []}

    def __init__(
        self,
        problem: ProblemInput,
        *,
        max_employees: int = 32,
        reward_config: RewardConfig | None = None,
        use_optimizer: bool = False,
        optimizer_client: OptimizerClient | None = None,
    ) -> None:
        super().__init__()
        if len(problem.employees) > max_employees:
            raise ValueError(
                f"problem has {len(problem.employees)} employees > max_employees={max_employees}; "
                "raise max_employees to fit the fleet."
            )
        self.problem = problem
        self.max_employees = max_employees
        self.reward_config = reward_config or RewardConfig()
        self.use_optimizer = use_optimizer
        self._optimizer_client = optimizer_client

        # Static index maps derived once from the problem.
        self._emp_index = {e.id: i for i, e in enumerate(problem.employees)}
        self._loc_index = {loc.id: i for i, loc in enumerate(problem.locations)}
        self._roles = sorted({d.role for d in problem.demands})
        self._role_index = {r: i for i, r in enumerate(self._roles)}
        # (employeeId, locId) -> travel minutes, for the commute feature.
        self._travel = {(t.employeeId, t.locId): t.minutes for t in problem.travelMatrix}

        # Expand demands into slots (one per unit of count).
        self._slots: list[_Slot] = [
            _Slot(demand_index=di, demand_id=d.id)
            for di, d in enumerate(problem.demands)
            for _ in range(max(0, d.count))
        ]

        # Spaces. Observation is fixed-width regardless of problem size (padded to max_employees).
        obs_dim = _DEMAND_FEATURES + self.max_employees * _EMP_FEATURES
        self.observation_space = spaces.Box(
            low=-1.0, high=np.inf, shape=(obs_dim,), dtype=np.float32
        )
        # +1 action = "leave this slot unfilled".
        self.action_space = spaces.Discrete(self.max_employees + 1)

        self._cursor = 0
        self._state = _EpisodeState()

    # -- gym.Env API ------------------------------------------------------------------------------

    def reset(self, *, seed: int | None = None, options: dict | None = None):  # noqa: ANN001
        super().reset(seed=seed)
        self._cursor = 0
        self._state = _EpisodeState()
        return self._observe(), self._info()

    def step(self, action: int):  # noqa: ANN001
        if self._cursor >= len(self._slots):
            raise RuntimeError("step() called on a finished episode; call reset() first.")

        slot = self._slots[self._cursor]
        demand = self.problem.demands[slot.demand_index]
        reward, kind = self._score_action(int(action), demand, slot)

        self._cursor += 1
        terminated = self._cursor >= len(self._slots)

        if terminated and self.use_optimizer:
            reward += self._terminal_optimizer_reward()

        obs = self._observe() if not terminated else self._zero_obs()
        info = self._info()
        info["last_action_kind"] = kind
        return obs, float(reward), terminated, False, info

    # -- reward -----------------------------------------------------------------------------------

    def _score_action(self, action: int, demand, slot: _Slot) -> tuple[float, str]:  # noqa: ANN001
        rc = self.reward_config
        # "Leave unfilled" action.
        if action == self.max_employees:
            return rc.unfilled, "unfilled"

        # Padded / non-existent employee index.
        if action >= len(self.problem.employees):
            return rc.hard_violation, "invalid_padding"

        emp = self.problem.employees[action]
        window = (demand.date, _hhmm_to_minutes(demand.start), _hhmm_to_minutes(demand.end))

        # H1: qualification.
        if demand.role not in emp.qualifications:
            return rc.hard_violation, "unqualified"
        # H3: approved leave that date.
        if demand.date in emp.approvedLeaveDates:
            return rc.hard_violation, "on_leave"
        # No double-booking an overlapping window.
        for booked in self._state.booked.get(emp.id, []):
            if _overlaps(booked, window):
                return rc.hard_violation, "double_booked"

        # Clean assignment — record it.
        self._state.assignments.append((emp.id, demand.id))
        self._state.booked.setdefault(emp.id, []).append(window)
        return rc.feasible, "feasible"

    def _terminal_optimizer_reward(self) -> float:
        """Terminal shaping from the live solver: reward coverage the solver proves achievable.

        Compares the demand ids the agent covered against the ids the optimizer manages to staff.
        Best-effort: if the optimizer is unreachable, contribute 0 rather than crash the rollout.
        """
        client = self._optimizer_client or OptimizerClient()
        try:
            result = client.solve(self.problem)
        except Exception:  # noqa: BLE001 — seam must never break the rollout; hardened in M2-C2.
            return 0.0

        solver_covered = {a.demandId for a in result.assignments}
        agent_covered = {demand_id for _, demand_id in self._state.assignments}
        # Reward overlap with the solver's coverage; penalise leaving solver-coverable slots empty.
        hits = len(agent_covered & solver_covered)
        misses = len(solver_covered - agent_covered)
        return self.reward_config.optimizer_feasibility * (hits - misses)

    # -- observation ------------------------------------------------------------------------------

    def _observe(self) -> np.ndarray:
        slot = self._slots[self._cursor]
        demand = self.problem.demands[slot.demand_index]
        parts = [self._demand_features(demand)]
        for i in range(self.max_employees):
            if i < len(self.problem.employees):
                parts.append(self._employee_features(self.problem.employees[i], demand))
            else:
                parts.append(np.full(_EMP_FEATURES, -1.0, dtype=np.float32))  # padded / masked
        return np.concatenate(parts).astype(np.float32)

    def _zero_obs(self) -> np.ndarray:
        return np.zeros(self.observation_space.shape, dtype=np.float32)

    def _demand_features(self, demand) -> np.ndarray:  # noqa: ANN001
        return np.array(
            [
                float(self._loc_index.get(demand.locId, -1)),
                float(self._role_index.get(demand.role, -1)),
                _hhmm_to_minutes(demand.start) / 60.0,
                _hhmm_to_minutes(demand.end) / 60.0,
                float(demand.count),
            ],
            dtype=np.float32,
        )

    def _employee_features(self, emp, demand) -> np.ndarray:  # noqa: ANN001
        qualified = 1.0 if demand.role in emp.qualifications else 0.0
        on_leave = 1.0 if demand.date in emp.approvedLeaveDates else 0.0
        already = float(len(self._state.booked.get(emp.id, [])))
        travel = self._travel.get((emp.id, demand.locId), -1.0)
        return np.array(
            [qualified, on_leave, already, emp.etat, emp.historyHours / 40.0, float(travel)],
            dtype=np.float32,
        )

    # -- misc -------------------------------------------------------------------------------------

    def _info(self) -> dict:
        return {
            "cursor": self._cursor,
            "total_slots": len(self._slots),
            "assignments": list(self._state.assignments),
        }

    @property
    def num_slots(self) -> int:
        return len(self._slots)

    def action_for_employee(self, employee_id: str) -> int:
        """Map an employeeId to its Discrete action index (used to replay expert demos for BC)."""
        return self._emp_index[employee_id]

    @property
    def unfilled_action(self) -> int:
        return self.max_employees
