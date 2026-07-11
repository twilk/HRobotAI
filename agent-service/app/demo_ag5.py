"""AG5 self-development demo — the **batch retrain pipeline** produces versioned policies whose
acceptance metric **rises** across ≥2 versions, each with a saved training artifact; and it
**reinforces AG2** by showing the edit-distance drop holds when driven by the batch retrain (not only
the online nudge).

This deliberately **reuses** the AG2 scenario rather than forking a parallel one: the scripted manager
(`manager_accepted_schedule`) and the correction generator (`_edits_toward`) are imported straight from
:mod:`app.demo_ag2`. The only new thing here is *how the policy learns* — via
:class:`app.retrain.RetrainPipeline` (batch re-fit from the accumulated feedback log) instead of the
per-call online nudge.

The loop (contrast with ``demo_ag2``'s online loop):

    1. cold-start the policy (BC, v1); propose;
    2. the scripted manager corrects the most-mismatched slots and those corrections are **appended to
       the feedback log** (accumulated) — *without* any online learning;
    3. run the **batch retrain**: throw away the affinity table, re-fit from the cold-start dataset +
       the *entire* accumulated log -> a NEW policy version with a persisted artifact;
    4. the next round proposes with that retrained policy. Repeat.

As the log grows, each retrain yields a strictly better policy until it converges to the
manager-accepted schedule: rising acceptance (AG5) == falling edit-distance (AG2), driven end-to-end
by the formal pipeline.

Run inside the container:

    python -m app.demo_ag5        # (or: python -m app.retrain) -> asserts >=2 rising versions, writes evidence/
"""

from __future__ import annotations

import json
import os

from .contract import Assignment
from .demo_ag2 import _edits_toward, manager_accepted_schedule
from .fixtures import canonical_problem
from .metrics import acceptance_metric, edit_distance
from .policy import reward_for_edit
from .retrain import RetrainPipeline
from .service import AgentService
from .store import AgentStore

EVIDENCE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evidence")
#: Per-version training artifacts land here so the evidence pack literally contains them (synthetic,
#: no PII). The *runtime* default artifacts dir (AGENT_DB_PATH-adjacent) is gitignored; this one is
#: committed as concrete AG5 proof.
AG5_ARTIFACTS_DIR = os.path.join(EVIDENCE_DIR, "ag5_artifacts")


def run_ag5_demo(
    rounds: int = 6,
    correction_budget: int = 6,
    tenant: str = "ag5-demo",
    artifacts_dir: str | None = None,
) -> dict:
    problem = canonical_problem()
    accepted = manager_accepted_schedule(problem)

    store = AgentStore(":memory:")
    service = AgentService(store)
    pipeline = RetrainPipeline(store, artifacts_dir=artifacts_dir or AG5_ARTIFACTS_DIR)

    history: list[dict] = []

    # v1 — cold-start baseline (BC only, no feedback). service.propose cold-starts + records v1.
    prop = service.propose(tenant, problem)
    proposed = [Assignment.model_validate(a) for a in prop["assignments"]]
    history.append(
        {
            "version": prop["policyVersion"],
            "stage": "cold-start-bc",
            "editDistance": edit_distance(proposed, accepted),
            "acceptanceMetric": acceptance_metric(proposed, accepted),
            "feedbackRows": 0,
            "artefactPath": None,
        }
    )

    for r in range(rounds):
        prop = service.propose(tenant, problem)  # propose with the latest (retrained) serving policy
        proposed = [Assignment.model_validate(a) for a in prop["assignments"]]

        # Manager corrections -> APPEND to the feedback log (accumulate). No online learning here:
        # the improvement must come from the batch retrain, isolating the pipeline as its cause.
        edits = _edits_toward(proposed, accepted, problem, correction_budget)
        for e in edits:
            store.add_feedback(
                tenant_id=tenant,
                proposal_id=prop["proposalId"],
                employee_id=e.get("toEmployeeId") or e.get("employeeId"),
                demand_id=e.get("demandId"),
                edit_type=e["editType"],
                reward_signal=reward_for_edit(e["editType"]),
            )

        # Batch retrain from the FULL accumulated log -> new versioned policy + saved artifact.
        res = pipeline.retrain(tenant, eval_problem=problem, eval_accepted=accepted)
        history.append(
            {
                "version": res["version"],
                "stage": "batch-retrain",
                "editDistance": res["editDistance"],
                "acceptanceMetric": res["acceptanceMetric"],
                "feedbackRows": res["metrics"]["feedbackRows"],
                "feedbackApplied": res["metrics"]["feedbackApplied"],
                "artefactPath": res["artefactPath"],
            }
        )
        if res["editDistance"] == 0:
            break  # converged to the manager-accepted schedule

    accs = [h["acceptanceMetric"] for h in history]
    dists = [h["editDistance"] for h in history]
    return {
        "scenario": "canonical-feasible (36 employees, 38 demands) — reused from the AG2 demo",
        "managerPreference": "give hours to full-timers first (etat-priority) — not encoded by the fixed-weight solver",
        "learning": "BATCH retrain pipeline (app.retrain) — re-fit from cold-start + full feedback log, NOT the online nudge",
        "metric": "acceptanceMetric = 1 - editDistance/(2*|accepted|); editDistance = |proposed △ manager_accepted|",
        "correctionBudgetPerRound": correction_budget,
        "acceptedAssignments": len(accepted),
        "policyVersions": len([h for h in history if h["stage"] == "batch-retrain"]),
        "acceptanceRising": all(b >= a for a, b in zip(accs, accs[1:])) and accs[-1] > accs[0],
        "editDistanceDropping": all(b <= a for a, b in zip(dists, dists[1:])) and dists[-1] < dists[0],
        "firstAcceptance": accs[0],
        "lastAcceptance": accs[-1],
        "firstEditDistance": dists[0],
        "lastEditDistance": dists[-1],
        "history": history,
    }


# --- evidence artifacts --------------------------------------------------------------------------


def _write_csv(path: str, history: list[dict]) -> None:
    lines = ["version,stage,editDistance,acceptanceMetric,feedbackRows,artefactPath"]
    for h in history:
        lines.append(
            f"{h['version']},{h['stage']},{h['editDistance']},{h['acceptanceMetric']},"
            f"{h['feedbackRows']},{h.get('artefactPath') or ''}"
        )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def _write_svg(path: str, history: list[dict]) -> None:
    """A tiny dependency-free line chart: acceptance metric rising per policy version."""
    w, h, pad = 640, 320, 48
    xs = list(range(len(history)))
    ys = [pt["acceptanceMetric"] for pt in history]
    labels = [f"v{pt['version']}" for pt in history]
    xmax = max(xs) or 1

    def px(x):
        return pad + (w - 2 * pad) * (x / xmax)

    def py(y):
        return (h - pad) - (h - 2 * pad) * y  # acceptance in [0,1]

    pts = " ".join(f"{px(x):.1f},{py(y):.1f}" for x, y in zip(xs, ys))
    dots = "".join(
        f'<circle cx="{px(x):.1f}" cy="{py(y):.1f}" r="4" fill="#16a34a"/>'
        f'<text x="{px(x):.1f}" y="{py(y)-10:.1f}" font-size="11" text-anchor="middle" fill="#334155">{y:.2f}</text>'
        f'<text x="{px(x):.1f}" y="{h-pad+16:.1f}" font-size="11" text-anchor="middle" fill="#475569">{lab}</text>'
        for x, y, lab in zip(xs, ys, labels)
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" font-family="sans-serif">
  <rect width="{w}" height="{h}" fill="white"/>
  <text x="{w/2}" y="24" font-size="15" font-weight="bold" text-anchor="middle" fill="#0f172a">AG5 — acceptance rises across batch-retrained policy versions</text>
  <line x1="{pad}" y1="{h-pad}" x2="{w-pad}" y2="{h-pad}" stroke="#94a3b8"/>
  <line x1="{pad}" y1="{pad}" x2="{pad}" y2="{h-pad}" stroke="#94a3b8"/>
  <text x="{w/2}" y="{h-10}" font-size="12" text-anchor="middle" fill="#475569">policy version (batch retrain)</text>
  <text x="16" y="{h/2}" font-size="12" text-anchor="middle" fill="#475569" transform="rotate(-90 16 {h/2})">acceptance metric</text>
  <polyline points="{pts}" fill="none" stroke="#16a34a" stroke-width="2.5"/>
  {dots}
</svg>
"""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(svg)


def write_artifacts(result: dict, out_dir: str = EVIDENCE_DIR) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, "ag5_result.json")
    csv_path = os.path.join(out_dir, "ag5_acceptance.csv")
    svg_path = os.path.join(out_dir, "ag5_chart.svg")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    _write_csv(csv_path, result["history"])
    _write_svg(svg_path, result["history"])
    return {"json": json_path, "csv": csv_path, "svg": svg_path}


def main() -> None:
    result = run_ag5_demo()
    paths = write_artifacts(result)

    print(json.dumps({k: v for k, v in result.items() if k != "history"}, indent=2))
    print("\nversion-by-version (acceptance / edit-distance / accumulated feedback):")
    for h in result["history"]:
        bar = "#" * round(h["acceptanceMetric"] * 40)
        art = os.path.basename(h["artefactPath"]) if h.get("artefactPath") else "(cold-start)"
        print(
            f"  v{h['version']:<2} {h['stage']:<13} acc={h['acceptanceMetric']:.3f} "
            f"dist={h['editDistance']:>3} fb={h['feedbackRows']:>3}  {bar}  {art}"
        )
    print(f"\nevidence: {paths}")
    print(f"artifacts: {AG5_ARTIFACTS_DIR}")

    n_versions = result["policyVersions"]
    if n_versions < 2:
        raise SystemExit(f"AG5 FAILED: expected >=2 retrained policy versions, got {n_versions}")
    if not result["acceptanceRising"]:
        raise SystemExit("AG5 FAILED: acceptance metric did not rise across versions")
    if not result["editDistanceDropping"]:
        raise SystemExit("AG2(via-pipeline) FAILED: edit-distance did not drop under batch retrain")
    print(
        f"\nAG5 OK: {n_versions} batch-retrained versions, acceptance "
        f"{result['firstAcceptance']:.3f} -> {result['lastAcceptance']:.3f} (rising); "
        f"AG2 edit-distance {result['firstEditDistance']} -> {result['lastEditDistance']} (dropping)."
    )


if __name__ == "__main__":  # pragma: no cover
    main()
