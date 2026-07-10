"""RetrainPipeline unit + endpoint tests — the formal batch retrain is a distinct, from-scratch
re-fit that persists a versioned AgentPolicyVersion (metrics + artefactPath) and a real artifact,
tenant-isolated."""

from __future__ import annotations

import os

from app.fixtures import CANONICAL_ID, canonical_problem
from app.policy import ImitationPolicy, PolicyState, slot_signature
from app.retrain import RetrainPipeline
from app.store import AgentStore


def _seed_move_feedback(store: AgentStore, tenant: str, problem, target_emp: str, n_demands: int = 3):
    """Log MOVE feedback steering ``n_demands`` slots toward ``target_emp`` for a real proposal."""
    demands = sorted(problem.demands, key=lambda d: d.id)[:n_demands]
    pid = store.save_proposal(
        tenant, 1, problem.model_dump(),
        [{"employeeId": "someone", "demandId": d.id} for d in demands], [],
    )
    for d in demands:
        store.add_feedback(
            tenant_id=tenant, proposal_id=pid, employee_id=target_emp,
            demand_id=d.id, edit_type="MOVE", reward_signal=-0.5,
        )
    return demands


def test_retrain_records_agentpolicyversion_with_metrics_and_artifact(tmp_path):
    store = AgentStore(":memory:")
    pipeline = RetrainPipeline(store, artifacts_dir=str(tmp_path / "art"))

    res = pipeline.retrain("t1")
    assert res["version"] == 1
    versions = store.policy_versions("t1")
    assert len(versions) == 1
    v = versions[0]
    # spec §6 AgentPolicyVersion shape.
    assert v["id"] and v["version"] == 1 and v["trainedAt"]
    assert v["artefactPath"] == res["artefactPath"]
    assert isinstance(v["metrics"], dict)
    assert v["metrics"]["trainMethod"].startswith("batch-refit")
    # Artifact really persisted and round-trips back into a PolicyState.
    assert os.path.exists(res["artefactPath"])
    reloaded = RetrainPipeline.load_artifact(res["artefactPath"])
    assert isinstance(reloaded, PolicyState)
    assert reloaded.version == 1


def test_retrain_versions_increment(tmp_path):
    store = AgentStore(":memory:")
    pipeline = RetrainPipeline(store, artifacts_dir=str(tmp_path / "art"))
    v1 = pipeline.retrain("t1")["version"]
    v2 = pipeline.retrain("t1")["version"]
    assert (v1, v2) == (1, 2)
    assert len(store.policy_versions("t1")) == 2


def test_batch_refit_folds_accumulated_feedback_from_scratch(tmp_path):
    """The batch retrain re-derives affinity from the WHOLE log — a from-scratch fit, not a nudge on
    top of prior state. Feedback steering a slot toward an employee shows up as positive affinity for
    exactly that (employee, slot-signature), reachable purely from the store."""
    store = AgentStore(":memory:")
    problem = canonical_problem()
    target = problem.employees[0].id
    demands = _seed_move_feedback(store, "t1", problem, target, n_demands=3)

    res = pipeline_res = RetrainPipeline(store, artifacts_dir=str(tmp_path / "art")).retrain(
        "t1", eval_problem=problem, eval_accepted=[]
    )
    assert res["metrics"]["feedbackRows"] == 3
    assert res["metrics"]["feedbackApplied"] == 3

    state = PolicyState.from_dict(store.load_policy("t1"))
    for d in demands:
        key = f"{target}::{slot_signature(d)}"
        assert state.affinity.get(key, 0.0) > 0, f"batch retrain did not reinforce {key}"


def test_retrain_is_tenant_isolated(tmp_path):
    store = AgentStore(":memory:")
    problem = canonical_problem()
    _seed_move_feedback(store, "tenant-A", problem, problem.employees[0].id, n_demands=2)
    pipeline = RetrainPipeline(store, artifacts_dir=str(tmp_path / "art"))

    ra = pipeline.retrain("tenant-A")
    rb = pipeline.retrain("tenant-B")
    assert ra["metrics"]["feedbackRows"] == 2
    assert rb["metrics"]["feedbackRows"] == 0  # B saw none of A's feedback
    assert store.policy_versions("tenant-A") and store.policy_versions("tenant-B")
    # Distinct artifact files per tenant.
    assert ra["artefactPath"] != rb["artefactPath"]


def test_retrain_endpoint(client):
    # Cold-start + a correction so there is accumulated feedback to re-fit on.
    prop = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID}).json()
    a0 = prop["assignments"][0]
    client.post("/agent/feedback", json={
        "proposalId": prop["proposalId"], "accepted": False,
        "edits": [{"editType": "MOVE", "demandId": a0["demandId"],
                   "fromEmployeeId": a0["employeeId"], "toEmployeeId": "zzz"}],
    })
    r = client.post("/agent/retrain", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] >= 2  # continues past the cold-start (v1) and any online-nudge version
    assert body["artefactPath"]
    assert body["metrics"]["trainMethod"].startswith("batch-refit")

    # /agent/policy surfaces the version history with the artifact reference.
    pol = client.get("/agent/policy").json()
    assert pol["latestArtefactPath"] == body["artefactPath"]
    assert any(tr.get("artefactPath") for tr in pol["trainingRuns"])
