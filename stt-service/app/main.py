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

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel

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


@app.post("/voice/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...),
    tenant: str = Depends(require_tenant),
) -> TranscribeResponse:
    """Transcribe one utterance. Requires a valid Keycloak bearer for an `hrobot-<slug>` realm.

    `tenant` is resolved from the token issuer and is intentionally NOT used to route or store
    anything — nothing about this request is persisted. It is bound so the endpoint cannot be
    reached unauthenticated, and so an audit trail has the same tenant notion as every other
    service if one is ever added.
    """
    data = await audio.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    try:
        result = _transcriber.transcribe(data)
    except ImportError as exc:
        # faster-whisper absent (e.g. a lean CI image): a clear 503 beats a 500 stack trace, and the
        # browser falls back to the text field, which is the primary demo surface anyway.
        raise HTTPException(status_code=503, detail="stt engine unavailable") from exc
    except Exception as exc:
        # Undecodable/corrupt audio — never echo the raw exception (it can carry buffer contents).
        raise HTTPException(status_code=422, detail="could not decode audio") from exc

    return TranscribeResponse(text=result.text, confidence=result.confidence)
