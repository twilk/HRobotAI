"""AG6 — one tenant's feedback and policy are never visible to another.

The tenant is now taken from the bearer token (``app.deps.require_tenant``), so each request carries a
token for its tenant via ``headers=auth("<tenant>")`` rather than a body/query ``tenantId``.
"""

from __future__ import annotations

from app.fixtures import CANONICAL_ID
from tests._authkit import auth


def test_feedback_and_policy_isolated_per_tenant(client):
    # Tenant A proposes and gives heavy corrective feedback.
    propA = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth("tenant-A")
    ).json()
    a0 = propA["assignments"][0]
    client.post(
        "/agent/feedback",
        json={
            "proposalId": propA["proposalId"],
            "edits": [
                {"editType": "MOVE", "demandId": a0["demandId"], "fromEmployeeId": a0["employeeId"], "toEmployeeId": "zzz"}
            ],
        },
        headers=auth("tenant-A"),
    )

    # Tenant B has independent, still-cold policy and zero feedback.
    polA = client.get("/agent/policy", headers=auth("tenant-A")).json()
    polB = client.get("/agent/policy", headers=auth("tenant-B")).json()
    assert polA["version"] >= 2  # A learned
    assert polB["version"] == 1  # B untouched
    assert polA["feedbackCount"] >= 1
    assert polB["feedbackCount"] == 0

    # B cannot read A's proposal (explain is tenant-scoped).
    r = client.get(
        "/agent/explain", params={"proposalId": propA["proposalId"]}, headers=auth("tenant-B")
    )
    assert r.status_code == 404
