"""Serving-path purity: the API must not reach the RL scaffolding.

README.md opens with an honest framing — "no module imports ``stable_baselines3``", "do not describe
this service as SB3 or RL" — and ``requirements.txt`` repeats it. Both are PROSE. One
``from .env import ...`` added to a serving module tomorrow turns them into a false statement, in the
exact document the milestone evidence pack points an auditor at, and nothing would fail.

This test pins the claim the same way ``test_weights_d_is_inert`` pins the optimizer's inert weight:
it walks the *static* import graph from ``app.main`` and asserts that no module reachable from the
running API imports ``gymnasium``, ``stable_baselines3``, ``torch`` or ``imitation``.

Deliberately static (``ast``), not an import-time probe: the heavy packages ARE installed in this
image, so importing ``app.main`` and checking ``sys.modules`` would only prove nothing *executed* an
import on that path — not that the code cannot. Reading the source is what makes the README's claim
checkable.

If this fails, the fix is to move the offending code out of the serving path, NOT to widen the
allowlist. Should the serving path ever legitimately gain a learned policy, the README's "Honest
framing" section and the evidence pack must change in the same commit — that coupling is the point.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"

# The offline imitation stack. Pinned in requirements.txt because `imitation` is built on them.
HEAVY = {"gymnasium", "stable_baselines3", "torch", "imitation"}

# Modules README.md documents as OUTSIDE the serving path. Kept as an assertion, not a skip-list:
# if one of these ever becomes reachable, the test below fails on the heavy import it drags in.
DOCUMENTED_NON_SERVING = {"env", "rollout", "sample", "train_bc"}


def _import_graph() -> dict[str, set[str]]:
    """Map each module in app/ to the top-level names it imports (local siblings included)."""
    graph: dict[str, set[str]] = {}
    for path in sorted(APP_DIR.glob("*.py")):
        names: set[str] = set()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                # Relative (`from .policy import X`) and absolute alike — the first segment is what
                # matters, and a relative import's module is already sibling-relative.
                names.add(node.module.split(".")[0])
        graph[path.stem] = names
    return graph


def _reachable_from(entry: str, graph: dict[str, set[str]]) -> set[str]:
    seen: set[str] = set()
    stack = [entry]
    while stack:
        mod = stack.pop()
        if mod in seen or mod not in graph:
            continue
        seen.add(mod)
        stack.extend(dep for dep in graph[mod] if dep in graph)
    return seen


def test_no_rl_dependency_is_reachable_from_the_api() -> None:
    graph = _import_graph()
    serving = _reachable_from("main", graph)

    offenders = {mod: sorted(graph[mod] & HEAVY) for mod in sorted(serving) if graph[mod] & HEAVY}
    assert offenders == {}, (
        "A module reachable from app.main imports the offline imitation stack. README.md's "
        f"'Honest framing' section and requirements.txt both claim this cannot happen: {offenders}"
    )


def test_the_scaffolding_modules_are_outside_the_serving_path() -> None:
    graph = _import_graph()
    serving = _reachable_from("main", graph)

    still_outside = DOCUMENTED_NON_SERVING - serving
    assert still_outside == DOCUMENTED_NON_SERVING, (
        "README.md documents these as not used by the API, but they are now reachable from "
        f"app.main: {sorted(DOCUMENTED_NON_SERVING & serving)}"
    )


def test_the_graph_walk_is_not_vacuous() -> None:
    """Sanity: if discovery broke, both assertions above would pass over an empty set."""
    graph = _import_graph()
    serving = _reachable_from("main", graph)

    # The real serving chain, named explicitly — these are the modules README.md calls the API path.
    for module in ("main", "agent_router", "service", "policy", "retrain", "store", "validate"):
        assert module in serving, f"{module} should be reachable from app.main"

    # And the scaffolding must actually import something heavy, else HEAVY is mis-spelled and the
    # first test can never fail.
    assert graph["env"] & HEAVY, "app/env.py no longer imports the RL stack — is HEAVY still right?"
    assert graph["train_bc"] & HEAVY, "app/train_bc.py no longer imports the imitation stack"
