"""Commute-cost provider — travelMatrix (primary) with a haversine fallback.

The frozen contract passes a precomputed ``travelMatrix`` (employee→location minutes) into
``/solve``, so that is the primary source. When an entry is missing but both endpoints carry
coordinates we fall back to a great-circle (haversine) estimate. The provider is expressed as a
small :class:`CommuteProvider` protocol so a real routing backend (OSRM road time) can drop in
later without touching the solver — it just implements ``minutes(employee_id, loc_id)``.

Everything here is pure/deterministic: same inputs → same minutes.
"""

from __future__ import annotations

import math
from typing import Protocol

from .contract import EmployeeInput, LatLng, LocationInput, TravelEntry

#: Average door-to-door speed (km/h) used to turn great-circle distance into minutes for the
#: haversine fallback. A deliberately conservative urban figure; an OSRM provider would replace
#: this whole estimate with real routed travel time. Kept as a module constant (not a contract
#: field) so the frozen envelope is untouched.
DEFAULT_SPEED_KMH = 30.0

#: Earth mean radius (km) for the haversine formula.
_EARTH_RADIUS_KM = 6371.0088


def haversine_km(a: LatLng, b: LatLng) -> float:
    """Great-circle distance in kilometres between two WGS84 coordinates."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lng, b.lat, b.lng))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def haversine_minutes(a: LatLng, b: LatLng, speed_kmh: float = DEFAULT_SPEED_KMH) -> float:
    """Great-circle travel time in minutes (distance / speed). OSRM-ready fallback."""
    return haversine_km(a, b) / speed_kmh * 60.0


class CommuteProvider(Protocol):
    """Anything that can price an employee→location commute in minutes.

    Return ``None`` when the cost is genuinely unknown (no matrix entry and no coordinates); the
    solver then treats that commute as zero (it cannot penalise an unknown). An OSRM-backed
    provider satisfies this same interface.
    """

    def minutes(self, employee_id: str, loc_id: str) -> float | None:  # pragma: no cover - protocol
        ...


class MatrixWithHaversineFallback:
    """Primary = frozen ``travelMatrix``; fallback = haversine when both coordinates are present."""

    def __init__(
        self,
        travel_matrix: list[TravelEntry],
        employees: list[EmployeeInput],
        locations: list[LocationInput],
        speed_kmh: float = DEFAULT_SPEED_KMH,
    ) -> None:
        self._matrix: dict[tuple[str, str], float] = {
            (t.employeeId, t.locId): t.minutes for t in travel_matrix
        }
        self._home: dict[str, LatLng | None] = {e.id: e.homeLatLng for e in employees}
        self._loc: dict[str, LatLng | None] = {loc.id: loc.latLng for loc in locations}
        self._speed_kmh = speed_kmh

    def minutes(self, employee_id: str, loc_id: str) -> float | None:
        entry = self._matrix.get((employee_id, loc_id))
        if entry is not None:
            return entry
        home = self._home.get(employee_id)
        loc = self._loc.get(loc_id)
        if home is not None and loc is not None:
            return haversine_minutes(home, loc, self._speed_kmh)
        return None
