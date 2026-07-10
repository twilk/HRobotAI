"""AG2 learning-loop demo — the money shot: edit-distance drops as feedback lands.

Fixed synthetic scenario (the canonical cold-start problem). A scripted **manager** has real slot
preferences the fixed-weight solver does not encode (here: "give hours to full-timers first"). The
loop:

    1. cold-start the policy by imitating the solver (BC), then propose a schedule;
    2. the manager corrects a budget of the most-mismatched slots (MOVE edits toward their preferred
       schedule) and sends them as `/agent/feedback`;
    3. the agent re-fits on that feedback (online reward) and re-proposes;
    4. repeat for N rounds, recording edit-distance(proposal, manager-accepted) each round.

Because a fixed-weight solver cannot adapt to the manager's preference, its edit-distance would stay
flat; the learning agent's drops monotonically toward zero. That gap is the whole point of the module
(spec §16, AG2). The drop is real — it comes from affinity the feedback moved, not a hard-coded
shortcut: run with ``--no-feedback`` to see the distance stay flat.

Run inside the container:

    python -m app.demo_ag2                 # runs the loop, asserts the drop, writes evidence/
    python -m app.demo_ag2 --no-feedback   # ablation: no learning → flat curve
"""

from __future__ import annotations

import argparse
import json
import os

from .contract import Assignment, ProblemInput
from .fixtures import canonical_problem
from .metrics import edit_distance, normalized_edit_distance
from .policy import ImitationPolicy, PolicyState, slot_signature
from .service import AgentService
from .store import AgentStore

EVIDENCE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evidence")


# --- the scripted manager ------------------------------------------------------------------------


def _manager_favor(emp) -> float:
    """A stable per-employee manager preference the solver's balanced objective does not encode:
    prefer full-timers (higher etat), tie-broken deterministically by id."""
    tiebreak = (int(emp.id[:8], 16) % 1000) / 1000.0
    return emp.etat * 5.0 + tiebreak


def manager_accepted_schedule(problem: ProblemInput) -> list[Assignment]:
    """The schedule the manager would keep — same greedy/feasibility as the agent, manager scoring.

    Built via the exact ``propose`` algorithm (same demand order, same H2/H4 conflict handling) but
    with the manager's preference baked into affinity, so it is (a) hard-feasible by construction and
    (b) reachable by the agent's own policy once feedback moves its affinity there.
    """
    state = PolicyState(version=0)
    pol = ImitationPolicy(state)
    for e in problem.employees:
        favor = _manager_favor(e)
        for d in problem.demands:
            if pol._eligible(e, d):
                state.affinity[f"{e.id}::{slot_signature(d)}"] = favor
    assignments, _ = pol.propose(problem)
    return assignments


def _edits_toward(proposed: list[Assignment], accepted: list[Assignment], problem: ProblemInput, budget: int):
    """MOVE edits that fix up to ``budget`` mismatched demands, most-mismatched first."""
    prop_by_d: dict[str, list[str]] = {}
    acc_by_d: dict[str, list[str]] = {}
    for a in proposed:
        prop_by_d.setdefault(a.demandId, []).append(a.employeeId)
    for a in accepted:
        acc_by_d.setdefault(a.demandId, []).append(a.employeeId)

    demands = sorted(
        acc_by_d,
        key=lambda did: -len(set(prop_by_d.get(did, [])) ^ set(acc_by_d.get(did, []))),
    )
    edits: list[dict] = []
    fixed = 0
    for did in demands:
        p = set(prop_by_d.get(did, []))
        a = set(acc_by_d.get(did, []))
        if p == a:
            continue
        outs = sorted(p - a)
        ins = sorted(a - p)
        for e_out, e_in in zip(outs, ins):
            edits.append({"editType": "MOVE", "demandId": did, "fromEmployeeId": e_out, "toEmployeeId": e_in})
        # extra manager picks the agent missed entirely (coverage gap) → ADD via MOVE-from-none
        for e_in in ins[len(outs):]:
            edits.append({"editType": "MOVE", "demandId": did, "fromEmployeeId": None, "toEmployeeId": e_in})
        fixed += 1
        if fixed >= budget:
            break
    return edits


# --- the loop ------------------------------------------------------------------------------------


def run_demo(rounds: int = 6, correction_budget: int = 6, use_feedback: bool = True, tenant: str = "ag2-demo"):
    problem = canonical_problem()
    accepted = manager_accepted_schedule(problem)

    store = AgentStore(":memory:")
    service = AgentService(store)

    history = []
    for r in range(rounds):
        prop = service.propose(tenant, problem)
        proposed = [Assignment.model_validate(a) for a in prop["assignments"]]
        dist = edit_distance(proposed, accepted)
        norm = round(normalized_edit_distance(proposed, accepted), 4)
        history.append(
            {
                "round": r,
                "policyVersion": prop["policyVersion"],
                "editDistance": dist,
                "normalizedEditDistance": norm,
                "acceptanceMetric": round(1.0 - norm, 4),
                "feasible": prop["feasibility"]["feasible"],
            }
        )
        if use_feedback:
            edits = _edits_toward(proposed, accepted, problem, correction_budget)
            if edits:
                service.feedback(tenant, prop["proposalId"], edits, accepted=False)

    return {
        "scenario": "canonical-feasible (36 employees, 38 demands, 52 assignments)",
        "managerPreference": "give hours to full-timers first (etat-priority) — not encoded by the fixed-weight solver",
        "metric": "edit_distance = |proposed △ manager_accepted| (symmetric difference of (employee,demand) pairs)",
        "rounds": rounds,
        "correctionBudgetPerRound": correction_budget,
        "useFeedback": use_feedback,
        "acceptedAssignments": len(accepted),
        "history": history,
    }


# --- artifacts -----------------------------------------------------------------------------------


def _write_csv(path: str, history: list[dict]) -> None:
    lines = ["round,policyVersion,editDistance,normalizedEditDistance,acceptanceMetric,feasible"]
    for h in history:
        lines.append(
            f"{h['round']},{h['policyVersion']},{h['editDistance']},{h['normalizedEditDistance']},"
            f"{h['acceptanceMetric']},{h['feasible']}"
        )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def _write_svg(path: str, history: list[dict]) -> None:
    """A tiny dependency-free line chart of edit-distance per round."""
    w, h, pad = 640, 320, 48
    xs = [pt["round"] for pt in history]
    ys = [pt["editDistance"] for pt in history]
    ymax = max(ys) or 1
    xmax = max(xs) or 1

    def px(x):
        return pad + (w - 2 * pad) * (x / xmax)

    def py(y):
        return (h - pad) - (h - 2 * pad) * (y / ymax)

    pts = " ".join(f"{px(x):.1f},{py(y):.1f}" for x, y in zip(xs, ys))
    dots = "".join(
        f'<circle cx="{px(x):.1f}" cy="{py(y):.1f}" r="4" fill="#2563eb"/>'
        f'<text x="{px(x):.1f}" y="{py(y)-10:.1f}" font-size="11" text-anchor="middle" fill="#334155">{y}</text>'
        for x, y in zip(xs, ys)
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" font-family="sans-serif">
  <rect width="{w}" height="{h}" fill="white"/>
  <text x="{w/2}" y="24" font-size="15" font-weight="bold" text-anchor="middle" fill="#0f172a">AG2 — edit-distance drops as manager feedback lands</text>
  <line x1="{pad}" y1="{h-pad}" x2="{w-pad}" y2="{h-pad}" stroke="#94a3b8"/>
  <line x1="{pad}" y1="{pad}" x2="{pad}" y2="{h-pad}" stroke="#94a3b8"/>
  <text x="{w/2}" y="{h-12}" font-size="12" text-anchor="middle" fill="#475569">feedback round</text>
  <text x="16" y="{h/2}" font-size="12" text-anchor="middle" fill="#475569" transform="rotate(-90 16 {h/2})">edit-distance</text>
  <polyline points="{pts}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
  {dots}
</svg>
"""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(svg)


def write_artifacts(result: dict, out_dir: str = EVIDENCE_DIR) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, "ag2_result.json")
    csv_path = os.path.join(out_dir, "ag2_editdistance.csv")
    svg_path = os.path.join(out_dir, "ag2_chart.svg")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    _write_csv(csv_path, result["history"])
    _write_svg(svg_path, result["history"])
    return {"json": json_path, "csv": csv_path, "svg": svg_path}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=6)
    ap.add_argument("--budget", type=int, default=6)
    ap.add_argument("--no-feedback", action="store_true", help="ablation: disable learning (flat curve)")
    args = ap.parse_args()

    result = run_demo(rounds=args.rounds, correction_budget=args.budget, use_feedback=not args.no_feedback)
    dists = [h["editDistance"] for h in result["history"]]
    result["firstEditDistance"] = dists[0]
    result["lastEditDistance"] = dists[-1]
    result["monotoneNonIncreasing"] = all(b <= a for a, b in zip(dists, dists[1:]))
    result["measurableDrop"] = dists[-1] < dists[0]

    paths = write_artifacts(result)
    print(json.dumps({k: v for k, v in result.items() if k != "history"}, indent=2))
    print("\nround-by-round edit-distance:")
    for h in result["history"]:
        bar = "#" * h["editDistance"]
        print(f"  v{h['policyVersion']:<2} round {h['round']}: {h['editDistance']:>3}  {bar}")
    print(f"\nartifacts: {paths}")

    if not result["measurableDrop"]:
        raise SystemExit("AG2 FAILED: no measurable edit-distance drop")
    print("\nAG2 OK: measurable edit-distance drop"
          + (" (monotone)" if result["monotoneNonIncreasing"] else ""))


if __name__ == "__main__":  # pragma: no cover
    main()
