"""Cold-start behavior-cloning entry point.

Reads a cold-start dataset of ``(ProblemInput -> assignments)`` pairs from a CONFIGURABLE path and
runs a minimal BC fit with the ``imitation`` library, cloning the expert's slot-filling decisions
into a policy over ``GrafikSchedulingEnv``'s action space. The parallel task (owns ``agent/``)
produces the real dataset; a tiny synthetic sample ships in ``data/coldstart_sample.jsonl`` so this
runs standalone for the smoke test.

    python -m app.train_bc --dataset data/coldstart_sample.jsonl --epochs 1

Dataset format (JSONL — one JSON object per line)
-------------------------------------------------
    {
      "problem":     { ...a full ProblemInput per the FROZEN contract... },
      "assignments": [ {"employeeId": "emp-1", "demandId": "dem-1"}, ... ]
    }

`assignments` is the expert (CP-SAT / human) label for `problem`: which employee fills each demand.
A demand of ``count`` C consumes up to C assignments (extra unfilled slots become the "leave
unfilled" action). This is exactly the ``SolveResult.assignments`` shape, so a dataset can be
produced by running the optimizer and pairing input↔output. Keep it synthetic (RODO: no PII).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .contract import Assignment, ProblemInput
from .env import GrafikSchedulingEnv

# Fixed fleet width so every sample yields the same observation/action space (BC requirement).
DEFAULT_MAX_EMPLOYEES = 32


def _load_dataset(path: Path) -> list[tuple[ProblemInput, list[Assignment]]]:
    samples: list[tuple[ProblemInput, list[Assignment]]] = []
    with path.open() as fh:
        for line_no, raw in enumerate(fh, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
                problem = ProblemInput.model_validate(obj["problem"])
                assignments = [Assignment.model_validate(a) for a in obj["assignments"]]
            except (json.JSONDecodeError, KeyError, ValueError) as exc:
                raise ValueError(f"{path}:{line_no}: malformed cold-start row: {exc}") from exc
            samples.append((problem, assignments))
    if not samples:
        raise ValueError(f"{path}: no samples found (expected JSONL of problem/assignments rows).")
    return samples


def _demos_for_sample(
    problem: ProblemInput, assignments: list[Assignment], max_employees: int
):
    """Replay the expert labels through the env, yielding (obs, act, next_obs, done) tuples."""
    env = GrafikSchedulingEnv(problem, max_employees=max_employees)
    obs, _ = env.reset()

    # Per-demand FIFO of expert-chosen employees; a slot pops the next one (or "unfilled").
    queues: dict[str, list[str]] = {}
    for a in assignments:
        queues.setdefault(a.demandId, []).append(a.employeeId)

    transitions = []
    terminated = False
    while not terminated:
        slot = env._slots[env._cursor]  # noqa: SLF001 — replay helper, same package
        queue = queues.get(slot.demand_id, [])
        if queue:
            action = env.action_for_employee(queue.pop(0))
        else:
            action = env.unfilled_action
        next_obs, _reward, terminated, _truncated, _info = env.step(action)
        transitions.append((obs, action, next_obs, terminated))
        obs = next_obs
    return transitions


def build_transitions(samples, max_employees: int):
    """Flatten all replayed demos into an ``imitation`` ``Transitions`` object."""
    from imitation.data.types import Transitions

    obs, acts, next_obs, dones, infos = [], [], [], [], []
    for problem, assignments in samples:
        for o, a, no, d in _demos_for_sample(problem, assignments, max_employees):
            obs.append(o)
            acts.append(a)
            next_obs.append(no)
            dones.append(d)
            infos.append({})
    return Transitions(
        obs=np.array(obs, dtype=np.float32),
        acts=np.array(acts, dtype=np.int64),
        next_obs=np.array(next_obs, dtype=np.float32),
        dones=np.array(dones, dtype=bool),
        infos=np.array(infos, dtype=object),
    )


def train(dataset: Path, epochs: int, max_employees: int, seed: int, save_path: Path | None):
    from imitation.algorithms import bc

    samples = _load_dataset(dataset)
    print(f"loaded {len(samples)} cold-start sample(s) from {dataset}")

    # A throwaway env just to expose the (shared) observation/action spaces to BC.
    spaces_env = GrafikSchedulingEnv(samples[0][0], max_employees=max_employees)
    transitions = build_transitions(samples, max_employees)
    n = len(transitions)
    print(f"built {n} expert transition(s); action_dim={spaces_env.action_space.n}")

    rng = np.random.default_rng(seed)
    trainer = bc.BC(
        observation_space=spaces_env.observation_space,
        action_space=spaces_env.action_space,
        demonstrations=transitions,
        batch_size=max(1, min(32, n)),
        rng=rng,
    )
    trainer.train(n_epochs=epochs)
    print(f"BC training complete: {epochs} epoch(s) over {n} transition(s)")

    if save_path is not None:
        save_path.parent.mkdir(parents=True, exist_ok=True)
        trainer.policy.save(str(save_path))
        print(f"saved cloned policy -> {save_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Cold-start behavior cloning for agent-service.")
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("data/coldstart_sample.jsonl"),
        help="Path to the JSONL cold-start dataset (configurable; parallel task produces the real one).",
    )
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--max-employees", type=int, default=DEFAULT_MAX_EMPLOYEES)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--save",
        type=Path,
        default=None,
        help="Optional path to save the cloned policy (skipped if omitted).",
    )
    args = parser.parse_args()
    train(args.dataset, args.epochs, args.max_employees, args.seed, args.save)


if __name__ == "__main__":
    main()
