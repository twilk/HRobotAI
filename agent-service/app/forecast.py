"""Weekly-seasonality demand forecaster (``/agent/forecast``).

A simple, honest seasonal model — **not** a heavy time-series ML stack (spec §8 keeps weather/event
forecasting out of M2). It recovers the weekly pattern by averaging each ``(role, day-of-week)`` over
the synthetic history, then projects that pattern forward across the horizon. This is the classic
"seasonal naive / seasonal mean" baseline: transparent, deterministic, and defensible for a demo.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from .fixtures import synthetic_demand_history


def forecast_demand(location_id: str, horizon: int, start: date | None = None) -> list[dict]:
    """Predict per-day, per-role demand for ``horizon`` days from ``start`` (default: canonical week).

    Method: mean count per ``(role, day-of-week)`` over the location's history, rounded to an integer
    head-count, replayed onto the future dates. Returns rows
    ``{date, dow, role, predictedCount, method}``.
    """
    horizon = max(0, int(horizon))
    start = start or date(2026, 7, 13)  # Monday of the canonical week
    history = synthetic_demand_history(location_id)

    # seasonal mean per (role, dow)
    sums: dict[tuple[str, int], float] = defaultdict(float)
    counts: dict[tuple[str, int], int] = defaultdict(int)
    roles = set()
    for row in history:
        key = (row["role"], row["dow"])
        sums[key] += row["count"]
        counts[key] += 1
        roles.add(row["role"])

    def seasonal_mean(role: str, dow: int) -> int:
        key = (role, dow)
        if counts[key] == 0:
            return 0
        return int(round(sums[key] / counts[key]))

    predictions: list[dict] = []
    for i in range(horizon):
        d = start + timedelta(days=i)
        dow = d.weekday()
        for role in sorted(roles):
            predictions.append(
                {
                    "date": d.isoformat(),
                    "dow": dow,
                    "role": role,
                    "predictedCount": seasonal_mean(role, dow),
                    "method": "weekly-seasonal-mean",
                }
            )
    return predictions
