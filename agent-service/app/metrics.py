"""Edit-distance between a proposed schedule and the manager-accepted schedule (AG2 metric).

Definition (documented, deterministic)
--------------------------------------
Each assignment is the pair ``(employeeId, demandId)``. Treating a schedule as the **set** of such
pairs, the edit-distance is the size of the symmetric difference:

    edit_distance(P, A) = |P \\ A| + |A \\ P|

i.e. the number of single-assignment changes (add or drop) needed to turn proposal ``P`` into the
manager-accepted schedule ``A`` — a MOVE counts as 2 (one drop + one add), which is the honest cost
of a reassignment. ``normalized`` divides by ``2·|A|`` so a from-scratch rebuild ≈ 1.0 and a perfect
match = 0.0. AG2 asserts this number drops (monotonically on the fixed scenario) as feedback lands.
"""

from __future__ import annotations

from .contract import Assignment


def _pairset(assignments: list[Assignment]) -> set[tuple[str, str]]:
    return {(a.employeeId, a.demandId) for a in assignments}


def edit_distance(proposed: list[Assignment], accepted: list[Assignment]) -> int:
    p, a = _pairset(proposed), _pairset(accepted)
    return len(p - a) + len(a - p)


def normalized_edit_distance(proposed: list[Assignment], accepted: list[Assignment]) -> float:
    a = _pairset(accepted)
    denom = 2 * len(a)
    if denom == 0:
        return 0.0
    return edit_distance(proposed, accepted) / denom


def acceptance_metric(proposed: list[Assignment], accepted: list[Assignment]) -> float:
    """Fraction of the accepted schedule the proposal already got right — ``1 - normalized``."""
    return round(1.0 - normalized_edit_distance(proposed, accepted), 4)
