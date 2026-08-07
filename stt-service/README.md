# stt-service — local speech-to-text (Agent Głosowy, M3)

The implementation of the seam documented in `apps/tenant-runtime/src/agent-glosowy/stt.port.ts`:
browser audio in, `{text, confidence}` out. Nothing else — intent parsing stays in
`intent.util.ts`, which is the single source of truth for understanding.

## Why local, and why not the browser's Web Speech API

A voice recording is personal data under GDPR, so the audio must not leave EU infrastructure. That
rules out both the hosted STT APIs and Chrome's `SpeechRecognition`, which uploads the audio to the
browser vendor's servers. The project's recorded decision is faster-whisper `small` (PL) on CPU —
see `docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md` §3.

Consequences, enforced in code:
- audio is handled in memory, never written to disk and never logged;
- only the transcript and a confidence number leave the process;
- no speaker identification, no biometric template, no emotion inference;
- after the one-time model download the service runs fully offline.

Speech **synthesis** (the assistant reading answers back) is a different matter and runs in the
browser via `speechSynthesis` — it renders locally from text and uploads nothing.

## API

| Method | Path                 | Auth                 | Body                     | Response                |
| ------ | -------------------- | -------------------- | ------------------------ | ----------------------- |
| GET    | `/health`            | none                 | —                        | `{status, model, loaded}` |
| POST   | `/voice/transcribe`  | Keycloak bearer      | multipart `audio` (webm/opus) | `{text, confidence}` |

`confidence` is `derive_confidence` over the decoder's per-segment statistics: `exp(avg_logprob)`
discounted by `no_speech_prob`, length-weighted across segments. Callers AND it with the intent
parser's own confidence (`lib/voice-capture.ts#pewnoscLaczna`), so a confident parse of a badly-heard
sentence still falls back to the manual form.

Error contract: `400` empty audio · `401` no/invalid bearer · `403` non-`hrobot-*` realm ·
`413` over `STT_MAX_AUDIO_BYTES` · `422` undecodable audio · `503` engine unavailable.

## Auth

`app/deps.py` is a deliberate copy of `agent-service/app/deps.py` (PoC §1 says to reuse the pattern,
not re-invent it): RS256 verified against the realm JWKS, tenant slug derived from the token issuer,
never from the request body. The two services are separate images with no shared Python package; if
one ever appears, both should import it instead.

## Configuration

| Variable              | Default              | Meaning                                  |
| --------------------- | -------------------- | ---------------------------------------- |
| `KEYCLOAK_URL`        | `http://keycloak:8080` | Anchor for logging; the token's `iss` is the authority |
| `STT_MODEL_SIZE`      | `small`              | `base` is the faster/lower-quality fallback |
| `STT_COMPUTE_TYPE`    | `int8`               | CPU quantisation                          |
| `STT_LANGUAGE`        | `pl`                 | Decoder language                          |
| `STT_MAX_AUDIO_BYTES` | `10485760`           | Upload ceiling                            |
| `HF_HOME`             | `/models`            | Model cache (a compose volume)            |

## Run

```
docker compose --profile full up -d stt      # first start downloads the model (~490 MB)
curl localhost:8010/health
```

web-kit reaches it through the same-origin proxy `app/api/voice/transcribe`, which attaches the
caller's bearer server-side; point it at the service with `STT_SERVICE_URL`.

## Tests

```
pip install -r requirements.txt
pytest -q          # 18 tests: confidence maths + the full HTTP contract incl. every error path
```

The confidence maths is pure and tested without the model, so the suite runs on a machine that never
downloads the weights. The model itself is exercised by the smoke run below.

## Smoke run (real Polish audio)

Verified 2026-08-03 on Windows/CPU with `small`+`int8`: a `pl-PL` sample synthesised with SAPI
("Chcę wziąć urlop od piątku do poniedziałku.") transcribed **verbatim**, `confidence ≈ 0.86`,
84.5 s wall clock including the one-time model download and load.
