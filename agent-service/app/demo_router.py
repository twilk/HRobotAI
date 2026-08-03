"""``/agent/demo/*`` — presentation helpers for the **J4 live demo** (UAT in front of 4Mobility).

This router adds NO new learning capability. It exposes the *scripted manager* that the committed
AG2/AG5 demos use (:func:`app.demo_ag2.manager_accepted_schedule` / :func:`app.demo_ag2._edits_toward`)
over HTTP so a thin, dependency-free client (``demo/j4_live_demo.py``) can drive the real running
service through the learning loop and *measure the edit-distance drop live* — against the same live
optimizer the rest of ``/agent/*`` talks to. The scripted manager stays **server-side and reused**
(not forked into the client), and everything here is on the fixed synthetic scenario (RODO-safe).

Endpoints:
  POST /agent/demo/corrections  { proposalId, budget?, manager? }   — bearer token required
      → { editDistance, normalizedEditDistance, acceptanceMetric, edits[], acceptedAssignments,
          managerModel, managerPreference }
        The scripted manager's MOVE corrections toward its preferred schedule for a given proposal,
        plus the live edit-distance / acceptance of that proposal vs. the manager-accepted schedule.
        ``manager`` selects the reference: ``constructed`` (default, unchanged J4 behaviour — but
        built by the agent's own ``propose``, see HON-2) or ``independent`` (built without the
        agent's policy; the honest number, and a much longer climb).
  GET  /agent/demo               → a self-served, same-origin HTML page that runs the same loop
        visually (optional stretch). It only calls the same-origin ``/agent/*`` endpoints, so no CORS.

Reuses the one process-wide ``AgentStore`` from :mod:`app.agent_router` so it reads the very proposals
``POST /agent/propose`` just wrote.

**Auth (AG6, same posture as the rest of ``/agent/*``):** ``/corrections`` reads a persisted proposal
out of that shared, tenant-partitioned store, so it is a *data-read* surface even though it is
demo-only — it must not be a back door around the tenant isolation the sibling routes enforce. It
therefore depends on :func:`app.deps.require_tenant`: the tenant comes from the verified token issuer,
and a ``tenantId`` in the request body is ignored (the model has no such field, and pydantic drops
extras) exactly as in :mod:`app.schemas`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from . import agent_router
from .contract import Assignment, ProblemInput
from .demo_ag2 import (
    MANAGER_CONSTRUCTED,
    MANAGER_DESCRIPTION,
    MANAGER_INDEPENDENT,
    _edits_toward,
    manager_truth,
)
from .deps import require_tenant
from .metrics import acceptance_metric, edit_distance, normalized_edit_distance

router = APIRouter(prefix="/agent/demo", tags=["agent-demo"])

MANAGER_PREFERENCE = (
    "give hours to full-timers first (etat-priority) — a preference the fixed-weight solver "
    "cannot encode"
)


class CorrectionsRequest(BaseModel):
    # No ``tenantId``: the tenant is derived from the authenticated bearer token (AG6). A caller that
    # still sends one has it silently dropped — it must never select which tenant's data is read.
    proposalId: str
    budget: int = 6
    #: Which reference schedule to correct toward — ``constructed`` (the original scenario, built by
    #: the agent's own ``propose``) or ``independent`` (HON-2: built without the agent's policy).
    #: Defaults to ``constructed`` so the committed J4 script and page are unchanged.
    #: NOTE: there is deliberately NO ``tenantId`` field — the tenant comes from the verified token
    #: issuer (AG6). Pydantic silently drops the extra key, so an old client sending it is ignored.
    manager: str = MANAGER_CONSTRUCTED


@router.post("/corrections")
def corrections(req: CorrectionsRequest, tenant: str = Depends(require_tenant)):
    """Return the scripted manager's corrections for a proposal + the live edit-distance/acceptance.

    Loads the proposal the service just persisted, reconstructs the manager-accepted schedule with the
    exact same helper the committed AG2 demo uses, and returns the MOVE edits toward it. The client
    feeds these straight back to ``POST /agent/feedback`` — so the whole learning loop is driven over
    HTTP against the running service, and the numbers here are the ones the audience watches fall.

    The proposal lookup is scoped to ``tenant`` from the token, so a caller can only ever see the
    rosters of the realm it authenticated against.
    """
    # Look the store up dynamically (not captured at import) so we always share the *current*
    # process-wide store — including after the test fixture reloads ``agent_router``.
    if req.manager not in (MANAGER_CONSTRUCTED, MANAGER_INDEPENDENT):
        raise HTTPException(status_code=422, detail=f"unknown manager model {req.manager!r}")
    proposal = agent_router._store.get_proposal(tenant, req.proposalId)
    if proposal is None:
        raise HTTPException(status_code=404, detail="unknown proposalId for tenant")
    problem = ProblemInput.model_validate(proposal["problem"])
    proposed = [Assignment.model_validate(a) for a in proposal["assignments"]]
    accepted = manager_truth(problem, req.manager)

    dist = edit_distance(proposed, accepted)
    norm = round(normalized_edit_distance(proposed, accepted), 4)
    edits = _edits_toward(proposed, accepted, problem, req.budget)
    return {
        "editDistance": dist,
        "normalizedEditDistance": norm,
        "acceptanceMetric": acceptance_metric(proposed, accepted),
        "edits": edits,
        "acceptedAssignments": len(accepted),
        "managerModel": req.manager,
        "managerPreference": (
            MANAGER_PREFERENCE
            if req.manager == MANAGER_CONSTRUCTED
            else MANAGER_DESCRIPTION[MANAGER_INDEPENDENT]
        ),
    }


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
def demo_page() -> str:
    """A same-origin HTML page that runs the live learning loop visually (optional stretch).

    Pure vanilla JS against the same-origin ``/agent/*`` endpoints — no build step, no external
    assets, no CORS. It reproduces the CLI loop: propose → scripted manager corrections →
    feedback → batch retrain → re-propose, animating the edit-distance number dropping to 0.
    """
    return _DEMO_HTML


_DEMO_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>J4 — self-learning scheduling agent (live)</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --blue:#2563eb; --green:#16a34a; --bg:#f8fafc; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:var(--ink); background:var(--bg); }
  header { padding:24px 28px; background:#fff; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 4px; font-size:20px; }
  header p { margin:0; color:var(--muted); font-size:14px; }
  main { max-width:980px; margin:0 auto; padding:24px 28px 60px; }
  .row { display:flex; gap:20px; flex-wrap:wrap; align-items:stretch; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px 20px; flex:1 1 220px; min-width:0; }
  .card h2 { margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; }
  .metric { font-size:44px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1.1; }
  .metric.dist { color:var(--blue); }
  .metric.acc { color:var(--green); }
  .sub { color:var(--muted); font-size:13px; margin-top:2px; }
  button { background:var(--blue); color:#fff; border:0; border-radius:8px; padding:11px 20px; font-size:15px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  button.secondary { background:#fff; color:var(--blue); border:1px solid var(--blue); margin-left:8px; }
  .bar-wrap { height:14px; background:#eef2f7; border-radius:8px; overflow:hidden; margin-top:10px; }
  .bar { height:100%; background:linear-gradient(90deg,#60a5fa,#2563eb); width:100%; transition:width .5s ease; }
  table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  tr.latest td { background:#f0f9ff; font-weight:600; }
  .status { margin:16px 0; padding:12px 16px; background:#fff; border:1px solid var(--line); border-radius:10px; font-size:14px; min-height:22px; }
  .pill { display:inline-block; padding:2px 9px; border-radius:999px; font-size:12px; font-weight:600; }
  .pill.ok { background:#dcfce7; color:#166534; }
  .pill.live { background:#dbeafe; color:#1e40af; }
  .note { color:var(--muted); font-size:12.5px; margin-top:6px; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:12.5px; }
  .auth { margin:16px 0 0; padding:12px 16px; background:#fff; border:1px solid var(--line); border-radius:10px; }
  .auth label { display:block; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; margin-bottom:6px; }
  .auth input { width:100%; padding:9px 11px; border:1px solid var(--line); border-radius:8px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12.5px; }
</style>
</head>
<body>
<header>
  <h1>Self-learning scheduling agent — live learning loop</h1>
  <p>Synthetic scenario (36 employees, 38 demands). The agent proposes a roster, a manager corrects it,
     the agent re-trains from those corrections, and the gap to the manager's schedule shrinks — live,
     against the real CP-SAT optimizer.</p>
</header>
<main>
  <div class="row">
    <div class="card">
      <h2>Edit-distance to manager's schedule</h2>
      <div id="dist" class="metric dist">—</div>
      <div class="sub">changes still needed to match the manager (lower = better)</div>
      <div class="bar-wrap"><div id="bar" class="bar"></div></div>
    </div>
    <div class="card">
      <h2>Agreement with manager</h2>
      <div id="acc" class="metric acc">—</div>
      <div class="sub">share of the manager's schedule the agent already gets right</div>
    </div>
    <div class="card">
      <h2>Policy version</h2>
      <div id="ver" class="metric">—</div>
      <div class="sub">bumped by each batch self-development retrain</div>
    </div>
  </div>

  <div class="auth">
    <label for="token">Keycloak access token</label>
    <input id="token" type="password" autocomplete="off" spellcheck="false"
           placeholder="paste an access token — every /agent/* call needs one"/>
    <p class="note">The agent takes your <b>tenant from this token's realm</b> and never from the request
       body, so one tenant can never read another's rosters. Nothing is stored: the token lives in this
       page for the length of the run.</p>
  </div>

  <div class="status" id="status">Ready. Paste a token above, then click
     <b>Reset demo agent to cold-start &amp; replay</b> to watch a fresh, untrained agent learn the
     manager's schedule from scratch.</div>
  <p><button id="reset">Reset demo agent to cold-start &amp; replay</button>
     <button id="run" class="secondary">Replay (keep current training)</button>
     <span id="feas"></span></p>
  <p class="note">“Reset &amp; replay” wipes <i>this demo tenant's</i> learned state and starts the agent from its
     day-1 cold-start baseline, so you always see the full climb from an untrained agent
     (edit-distance&nbsp;50&nbsp;→&nbsp;0, agreement&nbsp;52%&nbsp;→&nbsp;100%). It is a demo affordance to replay the
     learning loop — not a production reset.</p>

  <table id="tbl" hidden>
    <thead><tr><th>Round</th><th>Stage</th><th>Policy&nbsp;v</th><th>Edit-distance</th><th>Agreement</th><th>Manager corrections fed</th><th>Feasibility</th></tr></thead>
    <tbody></tbody>
  </table>
  <p class="note" id="healnote"></p>
  <p class="note">Every proposal's feasibility is validated and, via <code>POST /agent/heal</code>, repaired through the
     <b>live</b> CP-SAT optimizer — the same solver the production scheduler uses. Data is synthetic (RODO-safe).</p>
</main>

<script>
// No TENANT constant: every /agent/* route derives the tenant from the bearer token's issuer realm
// and ignores any tenantId in the body (AG6 tenant isolation), so the token alone decides whose
// rosters this page can see.
const ROUNDS = 6, BUDGET = 6, PROBLEM_ID = "syn-canonical-feasible";
const $ = (id) => document.getElementById(id);
const j = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(url + " -> " + r.status + " " + (await r.text()));
  return r.json();
};
const post = (url, body) => {
  const tok = $("token").value.trim();
  if (!tok) throw new Error("paste a Keycloak access token first — /agent/* requires one");
  return j(url, {method:"POST",
    headers:{"Content-Type":"application/json", "Authorization":"Bearer " + tok},
    body:JSON.stringify(body)});
};

let firstDist = null;
function paint(dist, acc, ver) {
  $("dist").textContent = dist;
  $("acc").textContent = Math.round(acc*100) + "%";
  $("ver").textContent = "v" + ver;
  if (firstDist === null) firstDist = dist || 1;
  $("bar").style.width = Math.round(100 * (dist / (firstDist||1))) + "%";
}
function addRow(cells, latest) {
  const tb = $("tbl").querySelector("tbody");
  for (const r of tb.querySelectorAll("tr.latest")) r.classList.remove("latest");
  const tr = document.createElement("tr");
  if (latest) tr.className = "latest";
  tr.innerHTML = cells.map(c => "<td>"+c+"</td>").join("");
  tb.appendChild(tr);
}

async function runDemo(opts) {
  opts = opts || {};
  $("run").disabled = true;
  $("reset").disabled = true;
  $("tbl").hidden = false;
  $("tbl").querySelector("tbody").innerHTML = "";
  firstDist = null;
  $("dist").textContent = "—"; $("acc").textContent = "—"; $("ver").textContent = "—";
  $("bar").style.width = "100%";

  // Reset & replay: return THIS demo tenant to its untrained cold-start policy first, so every run
  // shows the full climb from a fresh agent (deterministic 50 -> 0 / 52% -> 100%).
  if (opts.reset) {
    $("status").innerHTML = "Resetting the demo agent to a <b>fresh, untrained cold-start</b> policy…";
    const rs = await post("/agent/reset", {});
    $("status").innerHTML = "Agent reset to cold-start (policy <b>v" + rs.policyVersion
      + "</b>, feedback cleared). Starting the learning loop from scratch…";
  }

  // Live-optimizer proof: heal a deliberately-broken proposal through the real solver.
  $("status").innerHTML = "Contacting the <b>live CP-SAT optimizer</b> via /agent/heal…";
  try {
    const heal = await post("/agent/heal", {
      infeasibleProposal: {problemInputId: PROBLEM_ID, assignments: []}});
    $("healnote").innerHTML = "Live optimizer reached — <code>/agent/heal</code> returned solverStatus <b>"
      + heal.solverStatus + "</b> with " + heal.repairedAssignments.length
      + " repaired assignments and " + heal.unmet.length + " unmet.";
    $("feas").innerHTML = '<span class="pill live">live optimizer: ' + heal.solverStatus + '</span>';
  } catch (e) { $("healnote").textContent = "heal error: " + e.message; }

  for (let r = 0; r < ROUNDS; r++) {
    $("status").innerHTML = "Round " + (r+1) + "/" + ROUNDS + ": agent proposing a roster…";
    const prop = await post("/agent/propose", {problemInputId: PROBLEM_ID});
    const corr = await post("/agent/demo/corrections", {proposalId: prop.proposalId, budget: BUDGET});
    const feas = prop.feasibility.feasible ? '<span class="pill ok">feasible</span>' : "infeasible";
    paint(corr.editDistance, corr.acceptanceMetric, prop.policyVersion);
    addRow([r+1, "propose", "v"+prop.policyVersion, corr.editDistance,
            Math.round(corr.acceptanceMetric*100)+"%", "—", feas], true);

    if (corr.editDistance === 0) {
      $("status").innerHTML = 'Converged — the agent now reproduces the manager\\'s schedule exactly. '
        + '<span class="pill ok">edit-distance 0</span>';
      break;
    }
    $("status").innerHTML = "Round " + (r+1) + ": manager corrects " + corr.edits.length
      + " assignments → feedback → batch self-development retrain…";
    await post("/agent/feedback", {proposalId: prop.proposalId, edits: corr.edits, accepted: false});
    const rt = await post("/agent/retrain", {note: "J4 live page round " + (r+1)});
    addRow([r+1, "retrain", "v"+rt.version, "—", "—",
            (rt.metrics.feedbackApplied ?? rt.metrics.feedbackRows), "self-development"], false);
  }
  $("run").disabled = false;
  $("reset").disabled = false;
}
const guard = (fn) => fn().catch(e => {
  $("status").textContent = "Error: " + e.message;
  $("run").disabled = false; $("reset").disabled = false;
});
$("reset").addEventListener("click", () => guard(() => runDemo({reset: true})));
$("run").addEventListener("click", () => guard(() => runDemo()));
</script>
</body>
</html>
"""
