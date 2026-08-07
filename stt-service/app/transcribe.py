"""Speech-to-text core — faster-whisper `small` (PL), CPU, int8.

WHY LOCAL AND NOT A CLOUD STT: a voice recording is personal data under GDPR, so the audio must not
leave EU infrastructure. That is the project's recorded decision — see
`docs/superpowers/specs/2026-07-21-agent-glosowy-poc.md` §3 — and it rules out both the browser's
Web Speech API (Chrome ships the audio to the vendor's servers) and the hosted Whisper/Google/Azure
APIs. The model is downloaded once (~490 MB, `Systran/faster-whisper-small`) and then runs offline.

RODO posture, enforced by this module:
  * audio is handled in memory and is NEVER written to disk or logged;
  * only the transcript + a confidence number leave this process;
  * no speaker identification, no biometric template, no emotion/affect inference — speech → text.

The confidence maths is a PURE function ({@link derive_confidence}) so it can be unit-tested without
the model, which is what keeps this service verifiable on a machine that never downloads the weights.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Iterable, Protocol

# Domain vocabulary fed to the decoder as an `initial_prompt`. Whisper conditions on it, which
# measurably lifts accuracy on exactly the closed command set the agent understands (PoC §5) —
# the intent parser lives in tenant-runtime (`intent.util.ts`) and is NOT duplicated here.
INITIAL_PROMPT_PL = (
    "Polecenia kadrowe: urlop wypoczynkowy, wniosek urlopowy, zwolnienie lekarskie, L4, "
    "mój grafik, zmiana, dyżur, od poniedziałku do piątku, na jutro, na dziś."
)

MODEL_SIZE = os.environ.get("STT_MODEL_SIZE", "small")
COMPUTE_TYPE = os.environ.get("STT_COMPUTE_TYPE", "int8")
LANGUAGE = os.environ.get("STT_LANGUAGE", "pl")


@dataclass(frozen=True)
class SttResult:
    """Mirrors `SttPort`'s `SttResult` in apps/tenant-runtime/src/agent-glosowy/stt.port.ts."""

    text: str
    confidence: float


class _Segment(Protocol):
    """The subset of faster-whisper's `Segment` this module reads."""

    text: str
    avg_logprob: float
    no_speech_prob: float


def derive_confidence(segments: Iterable[_Segment]) -> float:
    """Collapse per-segment decoder statistics into one 0..1 confidence.

    `avg_logprob` is the mean token log-probability (≤ 0), so `exp(avg_logprob)` is the geometric
    mean token probability — the natural 0..1 reading of "how sure was the decoder". `no_speech_prob`
    is the decoder's estimate that a segment is silence/noise; a segment that is probably not speech
    must drag the score down, otherwise a cough transcribes to a confident-looking hallucination.

    Segments are weighted by transcript length so one stray two-word segment cannot dominate a long
    utterance. No segments at all (silence) → 0.0, which is below every threshold and therefore
    forces the caller's manual-form fallback rather than a guess.
    """
    total_weight = 0.0
    total_score = 0.0
    for seg in segments:
        weight = max(len(seg.text.strip()), 1)
        prob = math.exp(seg.avg_logprob) if seg.avg_logprob < 0 else 1.0
        score = prob * (1.0 - min(max(seg.no_speech_prob, 0.0), 1.0))
        total_score += score * weight
        total_weight += weight
    if total_weight == 0:
        return 0.0
    return round(min(max(total_score / total_weight, 0.0), 1.0), 4)


class Transcriber:
    """Lazily-loaded faster-whisper wrapper. The model is built on FIRST use, not at import.

    Loading costs ~1–2 s and ~1.5 GB RSS for `small`, so importing this module (as the tests do)
    must not pay for it. `WhisperModel` is thread-safe for sequential `transcribe` calls, which is
    all a single uvicorn worker issues.
    """

    def __init__(self, model_size: str = MODEL_SIZE, compute_type: str = COMPUTE_TYPE) -> None:
        self._model_size = model_size
        self._compute_type = compute_type
        self._model = None

    def _load(self):
        if self._model is None:
            # Imported here (not at module scope) so the module — and its pure confidence maths —
            # can be imported and tested on a machine with no faster-whisper installed.
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self._model_size, device="cpu", compute_type=self._compute_type
            )
        return self._model

    def transcribe(self, audio: bytes) -> SttResult:
        """Transcribe in-memory `webm/opus` (or any ffmpeg-readable) audio to Polish text.

        The bytes are wrapped in a `BytesIO` and never touch the filesystem — see the RODO note at
        the top of this module.
        """
        import io

        model = self._load()
        segments, _info = model.transcribe(
            io.BytesIO(audio),
            language=LANGUAGE,
            vad_filter=True,
            initial_prompt=INITIAL_PROMPT_PL,
        )
        collected = list(segments)
        text = "".join(seg.text for seg in collected).strip()
        return SttResult(text=text, confidence=derive_confidence(collected))
