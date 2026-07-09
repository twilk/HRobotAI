"""Smoke tests for the A1 skeleton: /health liveness + /solve contract round-trip.

No solver assertions here — the stub is expected to return INFEASIBLE with every demand unmet.
Run: `pip install -r requirements.txt httpx pytest && pytest` from grafik-optimizer/.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SAMPLE_PROBLEM = {
    "horizon": {"weekStart": "2026-07-06"},
    "locations": [{"id": "loc-1", "latLng": {"lat": 52.23, "lng": 21.01}}],
    "employees": [
        {
            "id": "emp-1",
            "qualifications": ["KASJER"],
            "etat": 1.0,
            "homeLatLng": {"lat": 52.24, "lng": 21.02},
            "approvedLeaveDates": ["2026-07-08"],
            "historyHours": 160,
        }
    ],
    "demands": [
        {
            "id": "dem-1",
            "locId": "loc-1",
            "date": "2026-07-06",
            "start": "08:00",
            "end": "16:00",
            "role": "KASJER",
            "count": 1,
        }
    ],
    "travelMatrix": [{"employeeId": "emp-1", "locId": "loc-1", "minutes": 12}],
    "weights": {"d": 100, "e": 10, "g": 1},
    "solverConfig": {"seed": 42, "timeLimit": 30},
}


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_solve_accepts_valid_problem_and_returns_schema_valid_result() -> None:
    resp = client.post("/solve", json=SAMPLE_PROBLEM)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "INFEASIBLE"
    assert body["assignments"] == []
    assert set(body["metrics"]) == {"commuteTotal", "etatDeviation", "fairnessScore"}
    assert [u["demandId"] for u in body["unmet"]] == ["dem-1"]


def test_solve_rejects_malformed_problem() -> None:
    resp = client.post("/solve", json={"horizon": {"weekStart": "2026-07-06"}})
    assert resp.status_code == 422
