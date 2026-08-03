"""HTTP contract tests for `POST /voice/transcribe` — the shape `SttPort` promises, plus every
error path a browser can actually hit.

Auth is overridden with FastAPI's dependency_overrides rather than minting real Keycloak tokens:
`require_tenant` is a byte-for-byte copy of the agent-service dependency that already has its own
coverage there, and what these tests must pin down is THIS service's contract — that an
unauthenticated call is refused, and that a authenticated one returns `{text, confidence}`.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import MAX_AUDIO_BYTES, app
from app.deps import require_tenant
from app.transcribe import SttResult


@pytest.fixture
def client():
    """Authenticated client — the tenant dependency is satisfied by a stub."""
    app.dependency_overrides[require_tenant] = lambda: "4mobility"
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def anon_client():
    """No override: the real Keycloak dependency runs and must refuse."""
    app.dependency_overrides.clear()
    return TestClient(app)


def test_health_needs_no_auth(anon_client):
    r = anon_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model"]
    # The model must NOT be eagerly loaded — a healthcheck cannot cost 1.5 GB.
    assert body["loaded"] is False


def test_transcribe_requires_a_bearer_token(anon_client):
    r = anon_client.post("/voice/transcribe", files={"audio": ("a.webm", b"\x00\x01", "audio/webm")})
    assert r.status_code == 401


def test_transcribe_returns_text_and_confidence(client, monkeypatch):
    monkeypatch.setattr(
        "app.main._transcriber.transcribe",
        lambda data: SttResult(text="chcę wziąć urlop od piątku", confidence=0.87),
    )
    r = client.post("/voice/transcribe", files={"audio": ("a.webm", b"\x00\x01\x02", "audio/webm")})
    assert r.status_code == 200
    assert r.json() == {"text": "chcę wziąć urlop od piątku", "confidence": 0.87}


def test_empty_audio_is_a_400(client):
    r = client.post("/voice/transcribe", files={"audio": ("a.webm", b"", "audio/webm")})
    assert r.status_code == 400


def test_oversized_audio_is_a_413(client):
    payload = b"\x00" * (MAX_AUDIO_BYTES + 1)
    r = client.post("/voice/transcribe", files={"audio": ("a.webm", payload, "audio/webm")})
    assert r.status_code == 413


def test_undecodable_audio_is_a_422_without_leaking_the_exception(client, monkeypatch):
    def boom(data):
        raise RuntimeError("ffmpeg said: <buffer 00 01 02 secret>")

    monkeypatch.setattr("app.main._transcriber.transcribe", boom)
    r = client.post("/voice/transcribe", files={"audio": ("a.webm", b"\x00\x01", "audio/webm")})
    assert r.status_code == 422
    assert r.json()["detail"] == "could not decode audio"
    assert "secret" not in r.text


def test_missing_engine_is_a_503(client, monkeypatch):
    def no_engine(data):
        raise ImportError("faster_whisper missing")

    monkeypatch.setattr("app.main._transcriber.transcribe", no_engine)
    r = client.post("/voice/transcribe", files={"audio": ("a.webm", b"\x00\x01", "audio/webm")})
    assert r.status_code == 503
    assert r.json()["detail"] == "stt engine unavailable"


def test_missing_file_field_is_a_422(client):
    assert client.post("/voice/transcribe").status_code == 422
