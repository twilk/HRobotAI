/**
 * `agent-glosowy` STT seam (documented boundary — NOT implemented here).
 *
 * The Voice/Text Agent's brain (intent parsing + interpret/execute over the real wnioski/grafik
 * APIs) works entirely on TEXT — the hard text fallback is the primary demo surface (spec §5/§6).
 * Speech-to-text (audio → text) is a SEPARATE, later concern and deliberately lives OUTSIDE this
 * NestJS module:
 *
 *  - The recommended adapter is a lightweight Python service running **faster-whisper `small` (PL)**
 *    on CPU (CTranslate2, `python:3.12-slim`), reusing the Keycloak/tenant auth pattern from
 *    `agent-service/app/deps.py`. See the PoC/feasibility report
 *    `docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md` (§2–§4, §6).
 *  - The model is downloaded once at runtime (~490 MB for `small`) and cached locally, then runs
 *    fully offline — audio never leaves EU infrastructure (RODO: a voice recording is personal data).
 *  - RODO: audio is processed in memory and NOT persisted by default; no biometric/emotion profiling
 *    (speech → text only).
 *
 * This interface exists so the browser microphone flow can transcribe audio and then feed the
 * resulting `text` into the SAME `POST /api/agent-glosowy/interpret` path a keyboard user hits. The
 * module is fully usable via text WITHOUT any STT adapter bound — this is only the shape a future
 * adapter must satisfy.
 */
export interface SttResult {
  /** The transcribed utterance (fed verbatim into `parseIntent`). */
  text: string
  /** STT confidence 0..1 (e.g. avg logprob / no-speech probability) — ANDed with intent confidence. */
  confidence: number
}

export interface SttPort {
  /**
   * Transcribe an audio buffer (webm/opus from `MediaRecorder`) to Polish text. Implemented by an
   * out-of-process faster-whisper adapter — see the file-level note above. NOT provided by this
   * module; the text pipeline does not depend on it.
   */
  transcribe(audio: Buffer): Promise<SttResult>
}

/** DI token for a future {@link SttPort} adapter (kept here so wiring has one obvious home). */
export const STT_PORT = Symbol('AGENT_GLOSOWY_STT_PORT')
