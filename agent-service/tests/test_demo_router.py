"""The J4 live-demo router: the scripted-manager corrections endpoint + the self-served page.

These guard the *presentation surface* only — the learning is already covered by the AG2/AG5 tests.
Here we assert the demo endpoints reuse the committed scripted manager correctly and stay same-origin.

The shared ``/agent/propose|feedback|retrain`` calls now derive the tenant from the bearer token, so
they carry ``headers=auth(tenant)``; the demo-corrections route keeps its own body ``tenantId``.
"""

from __future__ import annotations

from app.fixtures import CANONICAL_ID
from tests._authkit import auth


def test_corrections_returns_scripted_manager_edits(client):
    prop = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth("t1")
    ).json()
    r = client.post("/agent/demo/corrections", json={"proposalId": prop["proposalId"], "tenantId": "t1"})
    assert r.status_code == 200, r.text
    body = r.json()
    # Cold-start proposal vs. the scripted manager-accepted schedule: the canonical AG2 starting gap.
    assert body["editDistance"] == 50
    assert body["acceptanceMetric"] == 0.5192
    assert 0.0 < body["normalizedEditDistance"] < 1.0
    assert body["acceptedAssignments"] > 0
    assert "full-timers" in body["managerPreference"]
    # The edits are MOVE corrections the client can feed straight back to /agent/feedback.
    assert len(body["edits"]) > 0
    assert all(e["editType"] == "MOVE" for e in body["edits"])
    assert all("toEmployeeId" in e and "demandId" in e for e in body["edits"])


def test_corrections_drive_the_edit_distance_down(client):
    """One full round over the HTTP surface drops the edit-distance — the loop the CLI/page run."""
    tenant = "t2"
    p1 = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth(tenant)
    ).json()
    c1 = client.post(
        "/agent/demo/corrections", json={"proposalId": p1["proposalId"], "tenantId": tenant}
    ).json()
    client.post(
        "/agent/feedback",
        json={"proposalId": p1["proposalId"], "edits": c1["edits"], "accepted": False},
        headers=auth(tenant),
    )
    client.post("/agent/retrain", json={}, headers=auth(tenant))

    p2 = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth(tenant)
    ).json()
    c2 = client.post(
        "/agent/demo/corrections", json={"proposalId": p2["proposalId"], "tenantId": tenant}
    ).json()
    assert c2["editDistance"] < c1["editDistance"]


def test_corrections_unknown_proposal_404(client):
    r = client.post("/agent/demo/corrections", json={"proposalId": "nope", "tenantId": "t1"})
    assert r.status_code == 404


def test_demo_page_is_self_served_html(client):
    r = client.get("/agent/demo")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    html = r.text
    assert "<!doctype html>" in html.lower()
    assert "fetch(" in html
    assert "/agent/propose" in html and "/agent/demo/corrections" in html
    # Fully self-contained + same-origin: no external hosts anywhere (no CDN, no CORS).
    assert "http://" not in html and "https://" not in html


def test_corrections_default_manager_is_unchanged(client):
    """Backward compatibility: omitting `manager` keeps the committed J4 behaviour unchanged."""
    prop = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth("t5")
    ).json()
    body = client.post(
        "/agent/demo/corrections", json={"proposalId": prop["proposalId"], "tenantId": "t5"}
    ).json()
    assert body["managerModel"] == "constructed"
    assert body["editDistance"] == 50


def test_corrections_can_serve_the_independent_manager(client):
    """HON-2: the live demo surface can show the honest reference, not only the constructed one."""
    prop = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth("t6")
    ).json()
    body = client.post(
        "/agent/demo/corrections",
        json={"proposalId": prop["proposalId"], "tenantId": "t6", "manager": "independent"},
    ).json()
    assert body["managerModel"] == "independent"
    # The same cold-start proposal is much further from a manager the agent had no hand in defining.
    assert body["editDistance"] == 96
    assert body["acceptanceMetric"] == 0.0769
    assert "WITHOUT THE AGENT'S POLICY" in body["managerPreference"]


def test_corrections_rejects_an_unknown_manager_model(client):
    prop = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth("t7")
    ).json()
    r = client.post(
        "/agent/demo/corrections",
        json={"proposalId": prop["proposalId"], "tenantId": "t7", "manager": "marketing"},
    )
    assert r.status_code == 422
