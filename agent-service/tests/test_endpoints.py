"""All five /agent/* endpoints respond with the spec §5 shapes — no 501 seams remain."""

from __future__ import annotations

from app.fixtures import CANONICAL_ID


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_propose_by_problem_input_id(client):
    r = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(["assignments", "rationale", "policyVersion", "feasibility"]).issubset(body)
    assert body["policyVersion"] >= 1
    assert len(body["assignments"]) > 0
    # rationale is per-assignment with reasons
    assert len(body["rationale"]) == len(body["assignments"])
    assert all("reasons" in r_ and r_["reasons"] for r_ in body["rationale"])
    assert "feasible" in body["feasibility"]


def test_propose_requires_input(client):
    r = client.post("/agent/propose", json={})
    assert r.status_code == 422


def test_feedback_logs_reward_and_bumps_policy(client):
    prop = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID}).json()
    pid = prop["proposalId"]
    demand_id = prop["assignments"][0]["demandId"]
    from_emp = prop["assignments"][0]["employeeId"]
    r = client.post(
        "/agent/feedback",
        json={
            "proposalId": pid,
            "accepted": False,
            "edits": [
                {"editType": "MOVE", "demandId": demand_id, "fromEmployeeId": from_emp, "toEmployeeId": "some-other"}
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["rewardLogged"] == 1
    assert body["policyVersion"] >= 2  # learning bumped the version


def test_feedback_unknown_proposal_404(client):
    r = client.post("/agent/feedback", json={"proposalId": "nope", "edits": [], "accepted": True})
    assert r.status_code == 404


def test_explain_returns_rationale_and_alternatives(client):
    prop = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID}).json()
    pid = prop["proposalId"]
    demand_id = prop["assignments"][0]["demandId"]
    r = client.get("/agent/explain", params={"proposalId": pid, "demandId": demand_id})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rationale" in body and "alternativesConsidered" in body
    assert all(x["demandId"] == demand_id for x in body["rationale"])


def test_forecast_weekly_seasonality(client):
    r = client.post("/agent/forecast", json={"locationId": "loc-A", "horizon": 7})
    assert r.status_code == 200, r.text
    preds = r.json()["predictedDemand"]
    assert len(preds) == 7 * 4  # 7 days x 4 roles
    assert all(p["method"] == "weekly-seasonal-mean" for p in preds)


def test_policy_endpoint(client):
    client.post("/agent/propose", json={"problemInputId": CANONICAL_ID})
    r = client.get("/agent/policy", params={"tenantId": "demo-tenant"})
    assert r.status_code == 200
    body = r.json()
    assert body["version"] >= 1
    assert isinstance(body["trainingRuns"], list)
