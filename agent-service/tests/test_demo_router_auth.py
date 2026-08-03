"""AG6 for the J4 demo router — ``/agent/demo/corrections`` is NOT an unauthenticated back door.

The route reads a persisted proposal out of the same process-wide, tenant-partitioned
:class:`~app.store.AgentStore` the rest of ``/agent/*`` writes to. Before this suite it took the
tenant from the request body and carried no auth dependency at all, so an anonymous caller who
guessed (or was handed) a ``proposalId`` got another tenant's roster back — employee-level HR data.

These three assertions are the boundary:
  * no bearer token  → 401 *before* the store is touched (not a 404 leaked from the lookup),
  * token of tenant A + body ``tenantId`` of tenant B → B's proposal stays invisible,
  * a properly authenticated caller still gets the scripted manager's corrections.
"""

from __future__ import annotations

from app.fixtures import CANONICAL_ID
from tests._authkit import KC_URL, auth


def test_corrections_without_token_is_401(raw_client):
    """Anonymous callers are rejected at the door — the request never reaches the proposal store.

    A 404 here would itself be the bug: it proves the handler ran the tenant-scoped lookup for an
    unauthenticated caller, so a *valid* proposalId would have returned someone else's data.
    """
    r = raw_client.post(
        "/agent/demo/corrections", json={"proposalId": "anything", "tenantId": "t1"}
    )
    assert r.status_code == 401, r.text
    assert "unknown proposalId" not in r.text  # no store lookup leaked through


def test_corrections_malformed_token_is_401(raw_client):
    r = raw_client.post(
        "/agent/demo/corrections",
        json={"proposalId": "anything"},
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    assert r.status_code == 401, r.text


def test_corrections_non_hrobot_issuer_is_403(raw_client):
    r = raw_client.post(
        "/agent/demo/corrections",
        json={"proposalId": "anything"},
        headers=auth(iss=f"{KC_URL}/realms/master"),
    )
    assert r.status_code == 403, r.text


def test_corrections_cannot_read_another_tenants_proposal(client):
    """Token for `attacker`, body ``tenantId`` naming `victim` → victim's roster stays invisible.

    The body value must be ignored entirely (the schemas.py posture), so the lookup runs against
    `attacker`, which owns no such proposal.
    """
    victim = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth("victim")
    ).json()

    r = client.post(
        "/agent/demo/corrections",
        json={"proposalId": victim["proposalId"], "tenantId": "victim"},
        headers=auth("attacker"),
    )
    assert r.status_code == 404, r.text
    # And nothing of the victim's schedule came back with the rejection.
    assert "edits" not in r.json()


def test_corrections_tenant_comes_from_the_token(client):
    """The happy path: the tenant is derived from the issuer, so no body ``tenantId`` is needed."""
    prop = client.post(
        "/agent/propose", json={"problemInputId": CANONICAL_ID}, headers=auth("t-happy")
    ).json()

    r = client.post(
        "/agent/demo/corrections",
        json={"proposalId": prop["proposalId"]},
        headers=auth("t-happy"),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["editDistance"] == 50  # the canonical AG2 cold-start gap
    assert len(body["edits"]) > 0
    assert all(e["editType"] == "MOVE" for e in body["edits"])
