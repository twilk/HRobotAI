"""Unit tests for the confidence maths — the part that must be right without the 490 MB model.

`derive_confidence` decides whether a transcript is trustworthy enough to act on. It is ANDed with
the intent parser's own confidence downstream, so a bug here turns a mumble into a filed leave
request. It is pure, so it is tested exhaustively here; the model itself is exercised by the
in-container smoke run (see README).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.transcribe import INITIAL_PROMPT_PL, SttResult, Transcriber, derive_confidence


@dataclass
class FakeSegment:
    """Stands in for faster-whisper's `Segment` (only the three fields we read)."""

    text: str
    avg_logprob: float
    no_speech_prob: float


def test_no_segments_is_zero_confidence():
    """Silence must score 0 — below every threshold, so the caller falls back to the form."""
    assert derive_confidence([]) == 0.0


def test_perfect_segment_scores_near_one():
    seg = FakeSegment(text="chcę wziąć urlop", avg_logprob=0.0, no_speech_prob=0.0)
    assert derive_confidence([seg]) == 1.0


def test_confidence_is_exp_of_avg_logprob():
    seg = FakeSegment(text="urlop", avg_logprob=-0.2, no_speech_prob=0.0)
    assert derive_confidence([seg]) == round(math.exp(-0.2), 4)


def test_probable_silence_drags_confidence_down():
    """A segment the decoder thinks is 90% not-speech cannot come back as confident text."""
    speech = FakeSegment(text="urlop", avg_logprob=-0.1, no_speech_prob=0.0)
    noise = FakeSegment(text="urlop", avg_logprob=-0.1, no_speech_prob=0.9)
    assert derive_confidence([noise]) < derive_confidence([speech])
    assert derive_confidence([noise]) < 0.2


def test_segments_are_weighted_by_length():
    """One stray short segment must not outweigh a long, confident utterance."""
    long_good = FakeSegment(text="chcę wziąć urlop od piątku do poniedziałku", avg_logprob=-0.05, no_speech_prob=0.0)
    short_bad = FakeSegment(text="e", avg_logprob=-3.0, no_speech_prob=0.5)
    mixed = derive_confidence([long_good, short_bad])
    assert mixed > 0.8, mixed


def test_confidence_is_clamped_to_unit_interval():
    """A positive avg_logprob (shouldn't happen, but the field is a float) must not exceed 1."""
    weird = FakeSegment(text="x", avg_logprob=5.0, no_speech_prob=0.0)
    assert 0.0 <= derive_confidence([weird]) <= 1.0
    negative_noise = FakeSegment(text="x", avg_logprob=-1.0, no_speech_prob=-0.5)
    assert 0.0 <= derive_confidence([negative_noise]) <= 1.0


def test_domain_prompt_mentions_the_closed_command_set():
    """The initial prompt is what lifts PL accuracy on the three commands the agent supports."""
    for term in ("urlop", "zwolnienie lekarskie", "L4", "grafik"):
        assert term in INITIAL_PROMPT_PL


def test_model_is_not_loaded_at_construction():
    """Constructing the transcriber must not pay the ~1.5 GB / ~2 s model load — tests rely on it."""
    tr = Transcriber()
    assert tr._model is None


def test_missing_engine_surfaces_as_importerror(monkeypatch):
    """With faster-whisper absent, `_load` raises ImportError — main.py maps that to a 503."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "faster_whisper":
            raise ImportError("no faster_whisper here")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    tr = Transcriber()
    try:
        tr.transcribe(b"\x00\x01")
    except ImportError:
        return
    raise AssertionError("expected ImportError when the engine is missing")


def test_stt_result_shape_matches_the_port():
    """`SttResult` must stay `{text, confidence}` — parity with stt.port.ts's SttResult."""
    r = SttResult(text="chcę urlop", confidence=0.9)
    assert r.text == "chcę urlop"
    assert r.confidence == 0.9
    assert set(r.__dataclass_fields__) == {"text", "confidence"}
