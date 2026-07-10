"""The weight-0 manager-acceptance reward seam (RewardConfig.manager_acceptance) is wired (M2-C2).

Extends #20's env coverage: with the seam at weight 0 (default) a feasible assignment scores exactly
``feasible``; activating the weight rewards reproducing a manager-kept slot. This is the env-side
counterpart of the M2-C2 online feedback signal.
"""

from __future__ import annotations

from app.env import GrafikSchedulingEnv, RewardConfig
from app.sample import sample_problem


def test_seam_zero_weight_is_noop():
    env = GrafikSchedulingEnv(sample_problem())  # default RewardConfig: manager_acceptance = 0
    env.reset(seed=0)
    _, reward, _, _, info = env.step(env.action_for_employee("emp-1"))
    assert info["last_action_kind"] == "feasible"
    assert reward == RewardConfig().feasible  # no manager component when weight 0


def test_seam_rewards_manager_accepted_slot():
    problem = sample_problem()
    env = GrafikSchedulingEnv(
        problem,
        reward_config=RewardConfig(manager_acceptance=0.5),
        manager_accepted={("emp-1", "dem-1")},  # manager kept emp-1 on dem-1
    )
    env.reset(seed=0)
    _, reward, _, _, info = env.step(env.action_for_employee("emp-1"))
    assert info["last_action_kind"] == "feasible"
    assert reward == RewardConfig().feasible + 0.5  # feasible + manager-acceptance bonus
