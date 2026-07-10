"""Forecaster recovers the injected weekly seasonality (weekday peak, weekend trough)."""

from __future__ import annotations

from datetime import date

from app.forecast import forecast_demand


def test_forecast_shape_and_horizon():
    preds = forecast_demand("loc-A", horizon=14, start=date(2026, 7, 13))
    days = {p["date"] for p in preds}
    assert len(days) == 14
    roles = {p["role"] for p in preds}
    assert roles == {"KIEROWCA", "SERWISANT", "RECEPCJA", "KOORDYNATOR"}


def test_weekday_peak_above_weekend_trough():
    preds = forecast_demand("loc-A", horizon=7, start=date(2026, 7, 13))  # Mon..Sun
    kierowca = {p["dow"]: p["predictedCount"] for p in preds if p["role"] == "KIEROWCA"}
    # Friday (dow 4) peak strictly above Sunday (dow 6) trough — the recovered seasonality.
    assert kierowca[4] > kierowca[6]


def test_deterministic():
    a = forecast_demand("loc-A", horizon=7)
    b = forecast_demand("loc-A", horizon=7)
    assert a == b
