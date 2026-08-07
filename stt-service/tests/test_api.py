"""HTTP contract tests for `POST /voice/transcribe` — the shape `SttPort` promises, plus every
error path a browser can actually hit.

Auth is overridden with FastAPI's dependency_overrides rather than minting real Keycloak tokens:
`require_tenant` is a byte-for-byte copy of the agent-service dependency that already has its own
coverage there, and what these tests must pin down is THIS service's contract — that an
unauthenticated call is refused, and that a authenticated one returns `{text, confidence}`.
"""

from __future__ import annotations

import tempfile
import threading
import time

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


# --- W12: a slow transcription must not block the event loop (and /health with it) ------------


def test_health_responds_while_a_transcription_is_in_flight(monkeypatch):
    """`async def transcribe` calling synchronous, CPU-bound work directly runs it ON the single
    event loop thread that also serves `/health` — one transcription in flight makes the WHOLE
    process (including the compose healthcheck) unresponsive for its duration. This must not
    happen: `/health` must answer promptly while a transcription is still running.

    Uses `with TestClient(app) as client:` deliberately — that is what makes ALL requests through
    this client share ONE portal (one background event loop thread), matching a real uvicorn
    worker. The plain `client` fixture used elsewhere opens a FRESH portal per call, so two
    concurrent requests through it run on genuinely separate event loops and would pass this test
    even with the bug present — that would be a false negative for exactly what W12 is about.
    """
    app.dependency_overrides[require_tenant] = lambda: "4mobility"
    release = threading.Event()
    entered = threading.Event()

    def slow_transcribe(data):
        entered.set()
        # Blocks the CALLING thread synchronously — exactly what a CPU-bound faster-whisper run
        # does. If the event loop thread itself runs this, /health cannot be served until it wakes.
        release.wait(timeout=5)
        return SttResult(text="ok", confidence=0.9)

    monkeypatch.setattr("app.main._transcriber.transcribe", slow_transcribe)

    try:
        with TestClient(app) as client:
            result: dict[str, object] = {}

            def do_transcribe():
                result["response"] = client.post(
                    "/voice/transcribe", files={"audio": ("a.webm", b"\x00\x01\x02", "audio/webm")}
                )

            t = threading.Thread(target=do_transcribe)
            t.start()
            assert entered.wait(timeout=5), "transcribe() was never called"

            start = time.monotonic()
            health_response = client.get("/health")
            elapsed = time.monotonic() - start

            release.set()
            t.join(timeout=5)
    finally:
        app.dependency_overrides.clear()

    assert health_response.status_code == 200
    assert elapsed < 1.0, (
        f"/health took {elapsed:.2f}s while a transcription was in flight — "
        "the event loop was blocked by synchronous transcription work"
    )
    assert result["response"].status_code == 200


# --- W13: an oversized upload must be refused from Content-Length, before any disk buffering ---


def test_oversized_audio_never_spools_to_disk(client, monkeypatch):
    """`await audio.read()` before the size check meant the whole upload was already received —
    and, above Starlette's 1 MB in-memory threshold, already written to a `SpooledTemporaryFile`
    on disk — before the 413 was ever raised. `SpooledTemporaryFile.rollover` is the exact method
    that performs that disk write, so asserting it is never called is a direct proof that an
    oversized, rejected upload never touches disk (not just that the response code is right).
    """
    rollover_calls: list[int] = []
    original_rollover = tempfile.SpooledTemporaryFile.rollover

    def spy_rollover(self, *args, **kwargs):
        rollover_calls.append(1)
        return original_rollover(self, *args, **kwargs)

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", spy_rollover)

    payload = b"\x00" * (MAX_AUDIO_BYTES + 1)
    r = client.post("/voice/transcribe", files={"audio": ("a.webm", payload, "audio/webm")})

    assert r.status_code == 413
    assert rollover_calls == [], (
        "oversized upload caused SpooledTemporaryFile.rollover — audio was buffered to disk "
        "before the size limit was enforced"
    )


def test_content_length_missing_is_refused_without_reading_body(client, monkeypatch):
    """A body with no declared Content-Length (e.g. chunked transfer) must be refused outright
    rather than trusted — every real caller in this system (the web-kit proxy, which builds the
    request from a fully-buffered `ArrayBuffer`, and TestClient) always sends one, so requiring it
    closes the gap without breaking any real traffic.
    """
    parse_calls: list[int] = []

    async def spy_parse(self, *args, **kwargs):
        parse_calls.append(1)
        raise AssertionError("must not parse the multipart body without a Content-Length")

    monkeypatch.setattr("starlette.formparsers.MultiPartParser.parse", spy_parse)

    req = client.build_request(
        "POST",
        "/voice/transcribe",
        content=b"--x\r\nirrelevant\r\n--x--\r\n",
        headers={"content-type": "multipart/form-data; boundary=x"},
    )
    del req.headers["content-length"]
    r = client.send(req)

    assert r.status_code == 411
    assert parse_calls == []
