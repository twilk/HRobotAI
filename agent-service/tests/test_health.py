"""FastAPI surface: /health liveness + the /agent/* handlers are now implemented (M2-C2)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_agent_endpoints_are_implemented() -> None:
    # M2-C2 filled the phase-B 501 seams: /agent/propose now validates input (422 on empty body,
    # NOT 501) — proving the handler runs rather than returning the deferred stub.
    resp = client.post("/agent/propose", json={})
    assert resp.status_code == 422
    resp2 = client.post("/agent/propose", json={"problemInputId": "syn-canonical-feasible"})
    assert resp2.status_code == 200
    assert "assignments" in resp2.json()
