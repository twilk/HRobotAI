import type { LatLng } from '@hrobot/shared'

/** Mean Earth radius in kilometres (WGS84 spherical approximation). */
const EARTH_RADIUS_KM = 6371

/**
 * Assumed door-to-door commute speed (km/h) used to turn a straight-line haversine distance into
 * travel minutes for the solver's geo/commute term. A crude single-scalar proxy — real routing /
 * traffic is out of scope. Kept here (not in the frozen contract) so it can be tuned per deploy.
 */
export const ASSUMED_COMMUTE_KMH = 40

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Great-circle distance between two WGS84 coordinates, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Commute time in minutes from `a` to `b` via haversine distance at {@link ASSUMED_COMMUTE_KMH}. */
export function commuteMinutes(a: LatLng, b: LatLng, speedKmh: number = ASSUMED_COMMUTE_KMH): number {
  return (haversineKm(a, b) / speedKmh) * 60
}
