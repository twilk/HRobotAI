"""AG5 — the batch retrain pipeline produces >=2 policy versions with a rising acceptance metric and
a saved training artifact per version; and it reinforces AG2 (edit-distance drop) through the pipeline
rather than only the online nudge."""

from __future__ import annotations

import os

from app.demo_ag5 import run_ag5_demo


def test_batch_retrain_produces_multiple_rising_versions(tmp_path):
    result = run_ag5_demo(artifacts_dir=str(tmp_path / "artifacts"))

    retrains = [h for h in result["history"] if h["stage"] == "batch-retrain"]
    assert len(retrains) >= 2, f"expected >=2 batch-retrained versions, got {len(retrains)}"

    # AG5: acceptance rises monotonically (non-decreasing, strict net gain) across versions.
    accs = [h["acceptanceMetric"] for h in result["history"]]
    assert all(b >= a for a, b in zip(accs, accs[1:])), f"acceptance not monotone: {accs}"
    assert accs[-1] > accs[0], f"no net acceptance gain: {accs}"
    assert result["acceptanceRising"] is True

    # Each retrained version saved a real, non-empty training artifact on disk.
    for h in retrains:
        assert h["artefactPath"], f"version v{h['version']} recorded no artefactPath"
        assert os.path.exists(h["artefactPath"]), f"artifact missing: {h['artefactPath']}"
        assert os.path.getsize(h["artefactPath"]) > 0


def test_batch_retrain_reinforces_ag2_edit_distance_drop(tmp_path):
    result = run_ag5_demo(artifacts_dir=str(tmp_path / "artifacts"))
    dists = [h["editDistance"] for h in result["history"]]
    # AG2 through the batch pipeline: edit-distance drops monotonically to convergence.
    assert all(b <= a for a, b in zip(dists, dists[1:])), f"edit-distance not monotone: {dists}"
    assert dists[-1] < dists[0], f"no edit-distance drop: {dists}"
    assert dists[-1] == 0, f"did not converge to manager-accepted schedule: {dists}"
    assert result["editDistanceDropping"] is True
