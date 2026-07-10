"""AG6 — one tenant's feedback and policy are never visible to another."""

from __future__ import annotations

from app.fixtures import CANONICAL_ID


def test_feedback_and_policy_isolated_per_tenant(client):
    # Tenant A proposes and gives heavy corrective feedback.
    propA = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID, "tenantId": "tenant-A"}).json()
    a0 = propA["assignments"][0]
    client.post(
        "/agent/feedback",
        json={
            "proposalId": propA["proposalId"],
            "tenantId": "tenant-A",
            "edits": [
                {"editType": "MOVE", "demandId": a0["demandId"], "fromEmployeeId": a0["employeeId"], "toEmployeeId": "zzz"}
            ],
        },
    )

    # Tenant B has independent, still-cold policy and zero feedback.
    polA = client.get("/agent/policy", params={"tenantId": "tenant-A"}).json()
    polB = client.get("/agent/policy", params={"tenantId": "tenant-B"}).json()
    assert polA["version"] >= 2  # A learned
    assert polB["version"] == 1  # B untouched
    assert polA["feedbackCount"] >= 1
    assert polB["feedbackCount"] == 0

    # B cannot read A's proposal (explain is tenant-scoped).
    r = client.get("/agent/explain", params={"proposalId": propA["proposalId"], "tenantId": "tenant-B"})
    assert r.status_code == 404
