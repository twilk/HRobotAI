"""`stt-service` — the local speech-to-text adapter behind `SttPort`.

This service is the missing implementation of the seam documented in
`apps/tenant-runtime/src/agent-glosowy/stt.port.ts`: it takes `webm/opus` audio captured by the
browser's `MediaRecorder` and returns `{text, confidence}`, which the browser then feeds into the
SAME `POST /api/agent-glosowy/interpret` path a keyboard user hits. It is a SEPARATE image from
`agent-service` on purpose (PoC §1): faster-whisper needs CTranslate2, not torch/SB3, and mixing
them would bloat an already-heavy RL image.

It deliberately contains NO intent parsing. `intent.util.ts` in tenant-runtime is the single source
of truth for understanding; this service only turns sound into words.

Auth is the copied `agent-service` pattern (`app/deps.py`): Keycloak RS256 verified against the
realm JWKS, tenant slug derived from the token issuer, never from the request body.
"""

from __future__ import annotations

import os

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser, parse_options_header

from .deps import require_tenant
from .transcribe import Transcriber

app = FastAPI(title="HRobot STT service", version="1.0.0")

# One process-lifetime transcriber; the model loads on the first real request.
_transcriber = Transcriber()

# Refuse oversized uploads before spending memory on them. A spoken HR command is a few seconds of
# opus (tens of KB); 10 MB is generous and still bounds the blast radius of a hostile client.
MAX_AUDIO_BYTES = int(os.environ.get("STT_MAX_AUDIO_BYTES", 10 * 1024 * 1024))


class TranscribeResponse(BaseModel):
    """Wire shape of `SttResult` — parity with `stt.port.ts`'s `SttResult`."""

    text: str
    confidence: float


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness + which model this instance is configured for. No auth (compose healthcheck)."""
    return {
        "status": "ok",
        "model": _transcriber._model_size,  # noqa: SLF001 — deliberate: surfaced for ops/debug
        "loaded": _transcriber._model is not None,  # noqa: SLF001
    }


class _InMemoryMultiPartParser(MultiPartParser):
    """`MultiPartParser`, but with the in-memory ceiling raised to `MAX_AUDIO_BYTES`.

    Starlette's stock parser (used internally by `Request.form()` / `UploadFile = File(...)`) caps
    each file part at `max_file_size = 1 MB` and spools anything above that to a
    `SpooledTemporaryFile` **on disk** — a decision made purely by size, with no way to configure
    it via the public `Request.form()` API. That 1 MB threshold is well under `MAX_AUDIO_BYTES`
    (10 MB default), so even a request we intend to ACCEPT could already be written to disk before
    our handler runs, which is exactly what `route.ts`'s RODO comment promises never happens.
    Raising the ceiling to match our own limit keeps every upload we are willing to accept fully
    in memory.
    """

    max_file_size = MAX_AUDIO_BYTES


async def _parse_multipart_bounded(request: Request) -> FormData:
    """A trimmed `Request.form()` that plugs in `_InMemoryMultiPartParser` instead of the stock
    one — `Request._get_form` hardcodes its own parser with no extension point for `max_file_size`,
    so this reimplements just its content-type dispatch. Non-multipart bodies (or none at all)
    fall back to an empty form, matching `Request.form()`'s own behaviour.
    """
    content_type, _ = parse_options_header(request.headers.get("Content-Type"))
    if content_type != b"multipart/form-data":
        return FormData()
    try:
        parser = _InMemoryMultiPartParser(request.headers, request.stream())
        return await parser.parse()
    except MultiPartException as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc


@app.post("/voice/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    tenant: str = Depends(require_tenant),
) -> TranscribeResponse:
    """Transcribe one utterance. Requires a valid Keycloak bearer for an `hrobot-<slug>` realm.

    `tenant` is resolved from the token issuer and is intentionally NOT used to route or store
    anything — nothing about this request is persisted. It is bound so the endpoint cannot be
    reached unauthenticated, and so an audit trail has the same tenant notion as every other
    service if one is ever added.
    """
    # W13: reject an oversized upload from its DECLARED Content-Length, before any multipart
    # parsing runs at all. The previous code (`data = await audio.read()` then check) looked like
    # an ordering bug fixable inside the handler body, but declaring `audio: UploadFile = File(...)`
    # makes FastAPI parse the WHOLE multipart body — via Starlette's `MultiPartParser`, which spools
    # to disk once a part exceeds 1 MB — while resolving that parameter, BEFORE the handler body
    # runs at all. By the time any check inside this function executed, the bytes were already
    # fully received and, above 1 MB, already on disk; moving the comparison earlier in the
    # function could not have prevented that. This is why `audio` is no longer a `File(...)`
    # parameter — parsing is now entirely under this function's control, gated by the checks below.
    #
    # Every real caller sends a Content-Length: the web-kit proxy builds the body from a
    # fully-buffered `ArrayBuffer` (`route.ts`), and TestClient always computes one. A request
    # without one (e.g. chunked transfer) is refused rather than trusted, closing the one way this
    # guard could otherwise be bypassed.
    content_length_header = request.headers.get("content-length")
    if content_length_header is None:
        raise HTTPException(status_code=411, detail="Content-Length required")
    try:
        declared_length = int(content_length_header)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid Content-Length") from None
    if declared_length > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    form = await _parse_multipart_bounded(request)
    upload = form.get("audio")
    if not isinstance(upload, UploadFile):
        raise HTTPException(status_code=422, detail="missing file field 'audio'")

    data = await upload.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(data) > MAX_AUDIO_BYTES:
        # Belt-and-braces: the multipart envelope is always somewhat larger than the raw file, so
        # this should never trip once the Content-Length guard above has passed. Kept in case a
        # future multipart layout changes that relationship.
        raise HTTPException(status_code=413, detail="audio too large")

    # W12: `_transcriber.transcribe` is a synchronous, CPU-bound call (no `await` anywhere inside
    # it) that can run for several seconds. FastAPI only offloads plain `def` endpoints to a worker
    # thread automatically; this endpoint must stay `async def` (it awaits `request.stream()`
    # above), so calling a blocking function directly here would run it ON the single event loop
    # thread that also serves `/health` — one transcription in flight made the WHOLE process,
    # health check included, unresponsive for its duration. `run_in_threadpool` is the same
    # primitive FastAPI itself uses to offload sync `def` endpoints; using it explicitly here gets
    # the same offload for just this one blocking call.
    try:
        result = await run_in_threadpool(_transcriber.transcribe, data)
    except ImportError as exc:
        # faster-whisper absent (e.g. a lean CI image): a clear 503 beats a 500 stack trace, and the
        # browser falls back to the text field, which is the primary demo surface anyway.
        raise HTTPException(status_code=503, detail="stt engine unavailable") from exc
    except Exception as exc:
        # Undecodable/corrupt audio — never echo the raw exception (it can carry buffer contents).
        raise HTTPException(status_code=422, detail="could not decode audio") from exc

    return TranscribeResponse(text=result.text, confidence=result.confidence)
