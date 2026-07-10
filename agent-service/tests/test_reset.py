"""``POST /agent/reset`` — the tenant-scoped cold-start reset behind the demo's "Reset & replay".

Guards the three properties the acceptance criteria call out: after reset a fresh proposal is back
at the day-1 gap (~edit-distance 50 / ~52% agreement), the reset is **tenant-scoped** (never a
blanket wipe), and it is **idempotent** (resetting a fresh tenant, or resetting twice, is a no-op).
"""

from __future__ import annotations

from app.fixtures import CANONICAL_ID


def _gap(client, tenant: str) -> dict:
    """Propose for the demo scenario and return the live edit-distance / agreement vs the manager."""
    prop = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID, "tenantId": tenant}).json()
    corr = client.post(
        "/agent/demo/corrections", json={"proposalId": prop["proposalId"], "tenantId": tenant}
    ).json()
    return {"policyVersion": prop["policyVersion"], **corr}


def _train_one_round(client, tenant: str) -> None:
    prop = client.post("/agent/propose", json={"problemInputId": CANONICAL_ID, "tenantId": tenant}).json()
    corr = client.post(
        "/agent/demo/corrections", json={"proposalId": prop["proposalId"], "tenantId": tenant}
    ).json()
    client.post(
        "/agent/feedback",
        json={"proposalId": prop["proposalId"], "edits": corr["edits"], "accepted": False, "tenantId": tenant},
    )
    client.post("/agent/retrain", json={"tenantId": tenant})


def test_reset_returns_cold_start_gap(client):
    tenant = "reset-t1"
    # Train a few rounds so the policy has moved well off cold-start.
    before = _gap(client, tenant)["editDistance"]
    for _ in range(3):
        _train_one_round(client, tenant)
    trained = _gap(client, tenant)["editDistance"]
    assert trained < before, f"training did not move the policy: {before} -> {trained}"

    r = client.post("/agent/reset", json={"tenantId": tenant})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["policyVersion"] == 1
    assert body["feedbackCount"] == 0

    # A fresh proposal is back at the exact day-1 gap the AG2 demo starts from.
    after = _gap(client, tenant)
    assert after["policyVersion"] == 1
    assert after["editDistance"] == 50
    assert after["acceptanceMetric"] == 0.5192


def test_reset_is_tenant_scoped(client):
    """Resetting one tenant must not touch another tenant's learned policy (AG6)."""
    keep = "reset-keep"
    wipe = "reset-wipe"
    for _ in range(3):
        _train_one_round(client, keep)
        _train_one_round(client, wipe)
    keep_trained = _gap(client, keep)["editDistance"]
    assert keep_trained < 50

    client.post("/agent/reset", json={"tenantId": wipe})

    # The wiped tenant is back at cold-start...
    assert _gap(client, wipe)["editDistance"] == 50
    # ...while the untouched tenant keeps every bit of its training.
    assert _gap(client, keep)["editDistance"] == keep_trained


def test_reset_is_idempotent(client):
    tenant = "reset-idem"
    # Reset a pristine tenant (nothing to clear) — a clean no-op that still yields the cold-start gap.
    r0 = client.post("/agent/reset", json={"tenantId": tenant}).json()
    assert r0["ok"] is True and r0["policyVersion"] == 1
    assert _gap(client, tenant)["editDistance"] == 50

    for _ in range(2):
        _train_one_round(client, tenant)

    # Two resets in a row land at the identical cold-start state.
    first = client.post("/agent/reset", json={"tenantId": tenant}).json()
    second = client.post("/agent/reset", json={"tenantId": tenant}).json()
    assert first["policyVersion"] == second["policyVersion"] == 1
    assert second["feedbackCount"] == 0
    assert _gap(client, tenant)["editDistance"] == 50


def test_reset_then_replay_converges(client):
    """The full demo path: reset -> loop(propose/correct/feedback/retrain) climbs 50 -> 0 / 52% -> 100%."""
    tenant = "reset-replay"
    for _ in range(2):
        _train_one_round(client, tenant)
    client.post("/agent/reset", json={"tenantId": tenant})

    dists, accs = [], []
    for _ in range(6):
        g = _gap(client, tenant)
        dists.append(g["editDistance"])
        accs.append(g["acceptanceMetric"])
        if g["editDistance"] == 0:
            break
        prop_id = client.post(
            "/agent/propose", json={"problemInputId": CANONICAL_ID, "tenantId": tenant}
        ).json()["proposalId"]
        corr = client.post(
            "/agent/demo/corrections", json={"proposalId": prop_id, "tenantId": tenant}
        ).json()
        client.post(
            "/agent/feedback",
            json={"proposalId": prop_id, "edits": corr["edits"], "accepted": False, "tenantId": tenant},
        )
        client.post("/agent/retrain", json={"tenantId": tenant})

    assert dists[0] == 50 and accs[0] == 0.5192, f"did not start at cold-start: {dists[0]}/{accs[0]}"
    assert dists[-1] == 0 and accs[-1] == 1.0, f"did not converge: {dists} / {accs}"
    assert all(b <= a for a, b in zip(dists, dists[1:])), f"not monotone: {dists}"
