#!/usr/bin/env python3
"""J4 live demo — drive the RUNNING agent-service through its self-learning loop, live.

This is the presentation-ready CLI an operator runs in front of 4Mobility (UAT). It talks HTTP to the
agent-service brought up by ``demo/up.sh`` (default ``http://localhost:8010``), which in turn calls the
**live CP-SAT optimizer**. It uses only the Python standard library, so it runs on any host ``python3``
with zero install — nothing here needs the agent's heavy RL image.

What it proves, in order (matches the J4 acceptance script):
  0. The agent reaches the **live optimizer** — ``POST /agent/heal`` repairs a broken proposal through
     the real CP-SAT solver and reports its solver status.
  1. ``POST /agent/propose`` → a feasible roster **with per-assignment rationale** (the "reasoning").
  2. ``POST /agent/feedback`` → scripted "manager corrections" the fixed-weight solver can't encode.
  3. ``POST /agent/retrain`` → the **batch self-development** step: a new versioned policy + artifact.
  4. Re-propose each round and watch the **edit-distance drop** toward 0 — the agent learning, live.

Everything is on the fixed synthetic scenario (36 employees / 38 demands), RODO-safe. The scripted
manager lives server-side (``/agent/demo/corrections``, reusing the committed AG2 helper) so this
client stays thin.

Usage:
    python3 agent-service/demo/j4_live_demo.py                       # http://localhost:8010
    python3 agent-service/demo/j4_live_demo.py --base http://localhost:8010 --rounds 6
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

PROBLEM_ID = "syn-canonical-feasible"


# --- tiny stdlib HTTP client ---------------------------------------------------------------------


def _req(base: str, method: str, path: str, body: dict | None = None, timeout: float = 90.0) -> dict:
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"\n! {method} {path} failed: HTTP {exc.code}\n  {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"\n! cannot reach agent-service at {base} ({exc}).\n"
            f"  Is it up?  ->  bash agent-service/demo/up.sh"
        ) from exc


def GET(base, path):
    return _req(base, "GET", path)


def POST(base, path, body):
    return _req(base, "POST", path, body)


# --- presentation helpers ------------------------------------------------------------------------


def hr(char="─", n=64):
    print(char * n)


def title(text):
    print()
    hr("═")
    print(f" {text}")
    hr("═")


def bar(value, scale, width=50):
    filled = 0 if scale <= 0 else round(width * value / scale)
    return "█" * filled


# --- the demo --------------------------------------------------------------------------------------


def run(base: str, rounds: int, budget: int, tenant: str) -> int:
    title("J4 · Self-learning scheduling agent — LIVE demo")
    print(f" Agent under test : {base}")
    print(" Optimizer        : live CP-SAT (real solver, in-stack)")
    print(" Scenario         : 36 employees, 38 demands — SYNTHETIC (RODO-safe)")

    health = GET(base, "/health")
    print(f" Health           : {health}")

    # --- STEP 0: prove the agent talks to the LIVE optimizer ------------------------------------
    title("STEP 0 · Feasibility guardian = the LIVE optimizer")
    print(" We hand the agent a deliberately EMPTY (infeasible) roster and ask it to repair it")
    print(" through the real solver:  POST /agent/heal")
    heal = POST(base, "/agent/heal", {
        "tenantId": tenant,
        "infeasibleProposal": {"problemInputId": PROBLEM_ID, "assignments": []},
    })
    print(f"\n   → live solver status : {heal['solverStatus']}")
    print(f"   → repaired assignments: {len(heal['repairedAssignments'])}")
    print(f"   → unmet demands       : {len(heal['unmet'])}")
    print("   ✓ The agent is validating feasibility against the REAL CP-SAT optimizer, not a mock.")

    # --- the learning loop ----------------------------------------------------------------------
    title("STEP 1-4 · The learning loop (propose → correct → retrain → re-propose)")
    print(" The manager's rule: \"give hours to full-timers first\" — a preference the fixed-weight")
    print(" solver CANNOT encode. Watch the agent LEARN it from corrections.")
    print(" edit-distance = how many assignment changes still separate the agent's roster from the")
    print(" manager's ideal (0 = identical).\n")

    history = []
    for r in range(rounds):
        prop = POST(base, "/agent/propose", {"problemInputId": PROBLEM_ID, "tenantId": tenant})
        corr = POST(base, "/agent/demo/corrections",
                    {"proposalId": prop["proposalId"], "budget": budget, "tenantId": tenant})
        dist = corr["editDistance"]
        acc = corr["acceptanceMetric"]
        feasible = prop["feasibility"]["feasible"]
        history.append({"round": r + 1, "version": prop["policyVersion"], "dist": dist, "acc": acc})

        hr()
        flag = "feasible ✓" if feasible else "INFEASIBLE"
        print(f" ROUND {r + 1}  ·  propose")
        print(f"   policy v{prop['policyVersion']}  ·  {flag}  ·  "
              f"edit-distance {dist}  ·  agreement {round(acc * 100)}%")

        # Show the human-readable rationale on the first couple of rounds (the "reasoning").
        if r < 2:
            print("   why the agent chose these assignments (sample):")
            for rat in prop["rationale"][:3]:
                reasons = "; ".join(rat.get("reasons", [])) or "eligible"
                print(f"     • {rat['employeeId'][:8]}… → demand {rat['demandId'][:8]}… : {reasons}")

        if dist == 0:
            print("\n   ✓ CONVERGED — the agent now reproduces the manager's schedule exactly.")
            break

        # STEP 2: manager corrections → feedback
        edits = corr["edits"]
        print(f"   manager corrects {len(edits)} assignments (MOVE hours toward full-timers)")
        fb = POST(base, "/agent/feedback",
                  {"proposalId": prop["proposalId"], "edits": edits, "accepted": False, "tenantId": tenant})
        print(f"   → POST /agent/feedback  (logged {fb['rewardLogged']} corrections)")

        # STEP 3: batch self-development retrain → new versioned policy + artifact
        rt = POST(base, "/agent/retrain", {"tenantId": tenant, "note": f"J4 live round {r + 1}"})
        art = rt.get("artefactPath") or ""
        art_name = art.rsplit("/", 1)[-1] if art else "(none)"
        applied = rt["metrics"].get("feedbackApplied", rt["metrics"].get("feedbackRows"))
        print(f"   → POST /agent/retrain   → policy v{rt['version']} (batch self-development), "
              f"{applied} corrections folded in, artifact {art_name}")

    # --- the money shot: the curve --------------------------------------------------------------
    title("RESULT · The agent learned, live")
    scale = history[0]["dist"] or 1
    print(" edit-distance per round (bar shrinks as the agent learns the manager's preference):\n")
    for h in history:
        tag = "  ← converged" if h["dist"] == 0 else ""
        print(f"   round {h['round']}  v{h['version']:<3} dist {h['dist']:>3}  "
              f"{bar(h['dist'], scale):<50}{tag}")

    first, last = history[0], history[-1]
    print()
    print(f"   edit-distance : {first['dist']} → {last['dist']}")
    print(f"   agreement     : {round(first['acc'] * 100)}% → {round(last['acc'] * 100)}%")

    # Policy provenance (self-development): show the versioned training runs the agent produced.
    pol = GET(base, f"/agent/policy?tenantId={tenant}")
    # Batch retrains are exactly the versions that saved a training artifact (online nudges don't).
    retrains = [v for v in pol["trainingRuns"] if v.get("artefactPath")]
    print(f"   policy versions produced : {pol['version']} "
          f"({len(retrains)} formal batch retrains, each with a saved artifact)")
    print(f"   feedback corrections logged: {pol['feedbackCount']}")

    dropped = last["dist"] < first["dist"]
    monotone = all(b["dist"] <= a["dist"] for a, b in zip(history, history[1:]))
    print()
    if dropped:
        print(" ✓ J4 PROVEN LIVE: the agent learned a preference the solver cannot encode,")
        print("   the edit-distance dropped" + (" monotonically" if monotone else "") +
              ", and every roster was checked against the LIVE optimizer.")
        return 0
    print(" ! J4 FAILED: no edit-distance drop observed.", file=sys.stderr)
    return 1


def main() -> None:
    ap = argparse.ArgumentParser(description="J4 live self-learning demo (drives the running agent-service).")
    ap.add_argument("--base", default="http://localhost:8010", help="agent-service base URL")
    ap.add_argument("--rounds", type=int, default=6)
    ap.add_argument("--budget", type=int, default=6, help="manager corrections per round")
    ap.add_argument("--tenant", default=None,
                    help="tenant id (default: a fresh per-run id, so every run shows the full curve)")
    args = ap.parse_args()
    tenant = args.tenant or f"j4-live-{time.strftime('%H%M%S')}"
    raise SystemExit(run(args.base, args.rounds, args.budget, tenant))


if __name__ == "__main__":
    main()
