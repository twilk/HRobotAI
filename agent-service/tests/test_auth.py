"""C1 — /agent/* endpoints authenticate the bearer token and derive the tenant from its issuer.

The tenant must come from the verified ``iss`` claim (``…/realms/hrobot-<slug>``), never from a
``tenantId`` in the request body — otherwise any authenticated caller could act on another tenant
(AG6 tenant-isolation).
"""

from __future__ import annotations

import app.agent_router as ar
from app.fixtures import CANONICAL_ID
from tests._authkit import KC_URL, auth


def test_missing_bearer_returns_401(raw_client):
    r = raw_client.post("/agent/propose", json={"problemInputId": CANONICAL_ID})
    assert r.status_code == 401, r.text


def test_malformed_token_returns_401(raw_client):
    r = raw_client.post(
        "/agent/propose",
        json={"problemInputId": CANONICAL_ID},
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    assert r.status_code == 401, r.text


def test_non_hrobot_issuer_returns_403(raw_client):
    # Validly signed, but the issuer is not an hrobot-<slug> realm.
    r = raw_client.post(
        "/agent/propose",
        json={"problemInputId": CANONICAL_ID},
        headers=auth(iss=f"{KC_URL}/realms/master"),
    )
    assert r.status_code == 403, r.text


def test_tenant_derived_from_issuer_not_body(raw_client, monkeypatch):
    """A token for realm hrobot-acme with body tenantId=victim must call the service with 'acme'."""
    captured: dict[str, str] = {}

    def spy(tenant, problem):
        captured["tenant"] = tenant
        return {
            "proposalId": "p",
            "assignments": [],
            "rationale": [],
            "policyVersion": 1,
            "feasibility": {"feasible": True},
        }

    monkeypatch.setattr(ar._service, "propose", spy)

    r = raw_client.post(
        "/agent/propose",
        json={"problemInputId": CANONICAL_ID, "tenantId": "victim"},
        headers=auth("acme"),
    )
    assert r.status_code == 200, r.text
    assert captured["tenant"] == "acme"  # derived from iss, body tenantId ignored


def test_authenticated_propose_round_trips(client):
    # The default `client` carries a demo-tenant token — a normal propose succeeds end-to-end.
    r = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID})
    assert r.status_code == 200, r.text
    assert r.json()["policyVersion"] >= 1
