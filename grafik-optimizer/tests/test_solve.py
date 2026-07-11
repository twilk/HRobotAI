"""API-level round-trip tests: /health liveness + /solve contract via the real CP-SAT solver.

Solver acceptance (G1–G4) lives in ``test_solver.py``; this file exercises the FastAPI surface —
that the endpoint validates ProblemInput against the frozen contract and returns a schema-valid
SolveResult. The SAMPLE_PROBLEM is trivially feasible (one qualified employee, one demand, not on
leave that date) so the solver returns a real assignment, not the old A1 stub.
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
    # Trivially feasible → the sole qualified, available employee covers the sole demand.
    assert body["status"] == "OPTIMAL"
    assert body["assignments"] == [{"employeeId": "emp-1", "demandId": "dem-1"}]
    # preferencesHonoredPct is now populated (employee-preferences phase 2): emp-1 has no
    # preferences → the sole assignment honors vacuously → 1.0.
    assert set(body["metrics"]) == {
        "commuteTotal",
        "etatDeviation",
        "fairnessScore",
        "preferencesHonoredPct",
    }
    assert body["metrics"]["preferencesHonoredPct"] == 1.0
    assert body["unmet"] == []


def test_solve_infeasible_reports_unmet_not_error() -> None:
    # Demand for a role nobody is qualified for → INFEASIBLE with the slot echoed into unmet[].
    payload = {
        **SAMPLE_PROBLEM,
        "demands": [{**SAMPLE_PROBLEM["demands"][0], "id": "dem-x", "role": "PILOT"}],
    }
    resp = client.post("/solve", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "INFEASIBLE"
    assert [u["demandId"] for u in body["unmet"]] == ["dem-x"]


def test_solve_rejects_malformed_problem() -> None:
    resp = client.post("/solve", json={"horizon": {"weekStart": "2026-07-06"}})
    assert resp.status_code == 422
