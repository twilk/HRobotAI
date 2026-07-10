"""FastAPI surface: /health liveness + the /agent/* seam honestly returns 501 (not 404)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_agent_endpoints_are_documented_seams() -> None:
    # M2-C2 handlers not built yet — the seam must answer 501, proving it is wired but deferred.
    resp = client.post("/agent/propose")
    assert resp.status_code == 501
    assert "M2-C2" in resp.json()["detail"]
