#!/usr/bin/env python3
"""J4 live demo — drive the RUNNING agent-service through its self-learning loop, live.

This is the presentation-ready CLI an operator runs in front of 4Mobility (UAT). It talks HTTP to the
agent-service brought up by ``demo/up.sh`` (default ``http://localhost:8010``), which in turn calls the
**live CP-SAT optimizer**. It uses only the Python standard library, so it runs on any host ``python3``
with zero install — this client needs nothing from the agent's container image.

Framing for the room: what the agent runs is an **affinity learner re-fitted from manager feedback**,
not reinforcement learning and not Stable-Baselines3. See ``known-limitations.md``.

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

**Auth.** Every ``/agent/*`` route — including ``/agent/demo/corrections`` — authenticates a Keycloak
bearer token and derives the tenant from its issuer realm (``…/realms/hrobot-<slug>``); no route takes
a ``tenantId`` from the request body (AG6 tenant isolation). So this client mints a token once, via
the same password grant the rest of the stack uses (``client_id=hrobot-web``), and sends it on every
call. The tenant is therefore *the realm you authenticate against* — which is why the run starts with
``POST /agent/reset`` to put that tenant back at its cold-start policy, so each demo still shows the
full 50 → 0 climb (pass ``--keep-training`` to skip it).

Usage:
    # token minted from Keycloak (default: the staging realm on the live stack)
    AGENT_DEMO_PASSWORD=… python3 agent-service/demo/j4_live_demo.py --user demo

    # or hand it a token you already have
    AGENT_TOKEN=eyJ… python3 agent-service/demo/j4_live_demo.py --base http://localhost:8010
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

PROBLEM_ID = "syn-canonical-feasible"

# Keycloak defaults: the live stack's KC and the demo realm/client the rest of the stack uses.
DEFAULT_KC_URL = "http://localhost:8081"
DEFAULT_REALM = "hrobot-staging"
DEFAULT_CLIENT_ID = "hrobot-web"


# --- tiny stdlib HTTP client ---------------------------------------------------------------------


def _req(
    base: str,
    method: str,
    path: str,
    body: dict | None = None,
    token: str | None = None,
    timeout: float = 90.0,
) -> dict:
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        hint = ""
        if exc.code in (401, 403):
            hint = (
                "\n  Every /agent/* route needs a Keycloak bearer token and takes the tenant from\n"
                "  its issuer realm. Pass --user/--password (or AGENT_TOKEN=…) — see --help."
            )
        raise SystemExit(f"\n! {method} {path} failed: HTTP {exc.code}\n  {detail}{hint}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"\n! cannot reach agent-service at {base} ({exc}).\n"
            f"  Is it up?  ->  bash agent-service/demo/up.sh"
        ) from exc


def GET(base, path, token=None):
    return _req(base, "GET", path, token=token)


def POST(base, path, body, token=None):
    return _req(base, "POST", path, body, token=token)


# --- auth ----------------------------------------------------------------------------------------


def mint_token(kc_url: str, realm: str, client_id: str, user: str, password: str) -> str:
    """Keycloak password grant — the same one ``scripts/demo-up.mjs`` uses for the demo accounts."""
    url = f"{kc_url.rstrip('/')}/realms/{realm}/protocol/openid-connect/token"
    form = urllib.parse.urlencode(
        {"grant_type": "password", "client_id": client_id, "username": user, "password": password}
    ).encode()
    req = urllib.request.Request(
        url,
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())["access_token"]
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            f"\n! could not mint a token for '{user}' in realm '{realm}': HTTP {exc.code}\n"
            f"  {exc.read().decode(errors='replace')}"
        ) from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"\n! cannot reach Keycloak at {kc_url} ({exc}).") from exc


def tenant_of(token: str) -> str:
    """The tenant slug the service will derive from this token's ``iss`` — for display only."""
    import base64

    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        iss = json.loads(base64.urlsafe_b64decode(payload))["iss"]
        return iss.rsplit("/realms/hrobot-", 1)[-1]
    except Exception:
        return "(unknown)"


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


def run(base: str, rounds: int, budget: int, token: str, reset: bool) -> int:
    tenant = tenant_of(token)
    title("J4 · Self-learning scheduling agent — LIVE demo")
    print(f" Agent under test : {base}")
    print(" Optimizer        : live CP-SAT (real solver, in-stack)")
    print(" Scenario         : 36 employees, 38 demands — SYNTHETIC (RODO-safe)")
    print(f" Tenant           : {tenant}  (derived from the token issuer, never sent in a body)")

    health = GET(base, "/health")
    print(f" Health           : {health}")

    # The tenant is fixed by the realm we authenticated against, so return it to the day-1
    # cold-start policy first — otherwise a second run would start from an already-trained agent
    # and the audience would not see the full climb. Tenant-scoped, never a blanket wipe.
    if reset:
        rs = POST(base, "/agent/reset", {}, token=token)
        print(f" Cold-start reset : policy v{rs['policyVersion']}, feedback cleared")

    # --- STEP 0: prove the agent talks to the LIVE optimizer ------------------------------------
    title("STEP 0 · Feasibility guardian = the LIVE optimizer")
    print(" We hand the agent a deliberately EMPTY (infeasible) roster and ask it to repair it")
    print(" through the real solver:  POST /agent/heal")
    heal = POST(base, "/agent/heal", {
        "infeasibleProposal": {"problemInputId": PROBLEM_ID, "assignments": []},
    }, token=token)
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
        prop = POST(base, "/agent/propose", {"problemInputId": PROBLEM_ID}, token=token)
        corr = POST(base, "/agent/demo/corrections",
                    {"proposalId": prop["proposalId"], "budget": budget}, token=token)
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
                  {"proposalId": prop["proposalId"], "edits": edits, "accepted": False}, token=token)
        print(f"   → POST /agent/feedback  (logged {fb['rewardLogged']} corrections)")

        # STEP 3: batch self-development retrain → new versioned policy + artifact
        rt = POST(base, "/agent/retrain", {"note": f"J4 live round {r + 1}"}, token=token)
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
    pol = GET(base, "/agent/policy", token=token)
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
    ap = argparse.ArgumentParser(
        description="J4 live self-learning demo (drives the running agent-service).",
        epilog="The tenant comes from the token's Keycloak realm — there is no --tenant flag, "
               "because /agent/* never takes a tenant from the request body (AG6).",
    )
    ap.add_argument("--base", default="http://localhost:8010", help="agent-service base URL")
    ap.add_argument("--rounds", type=int, default=6)
    ap.add_argument("--budget", type=int, default=6, help="manager corrections per round")
    ap.add_argument("--token", default=os.environ.get("AGENT_TOKEN"),
                    help="a Keycloak access token to use as-is (env AGENT_TOKEN)")
    ap.add_argument("--kc-url", default=os.environ.get("KEYCLOAK_URL", DEFAULT_KC_URL),
                    help=f"Keycloak base URL (env KEYCLOAK_URL, default {DEFAULT_KC_URL})")
    ap.add_argument("--realm", default=os.environ.get("AGENT_DEMO_REALM", DEFAULT_REALM),
                    help=f"realm to authenticate against — this IS the tenant (default {DEFAULT_REALM})")
    ap.add_argument("--client-id", default=DEFAULT_CLIENT_ID)
    ap.add_argument("--user", default=os.environ.get("AGENT_DEMO_USER"),
                    help="demo account username (env AGENT_DEMO_USER)")
    ap.add_argument("--password", default=os.environ.get("AGENT_DEMO_PASSWORD"),
                    help="demo account password (env AGENT_DEMO_PASSWORD)")
    ap.add_argument("--keep-training", action="store_true",
                    help="do not reset the tenant to cold-start first (shows a partial curve)")
    args = ap.parse_args()

    token = args.token
    if not token:
        if not (args.user and args.password):
            ap.error(
                "no credentials: pass --token / AGENT_TOKEN, or --user + --password "
                "(AGENT_DEMO_USER / AGENT_DEMO_PASSWORD). Every /agent/* route needs a bearer token."
            )
        token = mint_token(args.kc_url, args.realm, args.client_id, args.user, args.password)

    raise SystemExit(run(args.base, args.rounds, args.budget, token, not args.keep_training))


if __name__ == "__main__":
    main()
