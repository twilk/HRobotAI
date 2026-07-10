"""Runnable random-action rollout — the env smoke test.

    python -m app.rollout                 # offline (default): pure random policy, no optimizer
    OPTIMIZER_URL=http://host:8001 \
        python -m app.rollout --use-optimizer   # also exercises the live /solve seam

Prints each step and a summary so the containerised smoke run has visible evidence the Gym-env
instantiates and completes an episode end-to-end.
"""

from __future__ import annotations

import argparse

import numpy as np

from .env import GrafikSchedulingEnv
from .sample import sample_problem


def main() -> None:
    parser = argparse.ArgumentParser(description="Random-action rollout of GrafikSchedulingEnv.")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--use-optimizer",
        action="store_true",
        help="Adjudicate a terminal feasibility reward via the live optimizer POST /solve.",
    )
    args = parser.parse_args()

    env = GrafikSchedulingEnv(sample_problem(), use_optimizer=args.use_optimizer)
    obs, info = env.reset(seed=args.seed)
    rng = np.random.default_rng(args.seed)

    print(f"env ready: {env.num_slots} slots, obs_dim={obs.shape[0]}, actions={env.action_space.n}")
    total = 0.0
    terminated = False
    step = 0
    while not terminated:
        action = int(rng.integers(0, env.action_space.n))
        obs, reward, terminated, truncated, info = env.step(action)
        total += reward
        print(
            f"  step {step}: action={action} reward={reward:+.2f} "
            f"kind={info['last_action_kind']}"
        )
        step += 1

    print(f"rollout complete: {step} steps, total_reward={total:+.2f}")
    print(f"assignments: {info['assignments']}")


if __name__ == "__main__":
    main()
