import { TenantPrisma } from '@hrobot/db'

const { Decimal } = TenantPrisma
type DecimalLike = InstanceType<typeof Decimal>

/**
 * "Szacunkowy dojazd (demo)" — every function in this file is a DEMO-GRADE travel estimate, not a
 * reimbursement-grade figure (Codex P2-8): {@link haversineKm} is a straight-line great-circle
 * distance, NOT real road routing, so it UNDERSTATES actual driving distance; {@link travelMinutes}
 * assumes a constant average speed with no traffic/routing. Good enough to rank cross-unit
 * replacement candidates and show an approximate cost/time in the demo UI — label any user-facing
 * surface "szacunkowy dojazd (demo)" rather than presenting these as exact figures.
 *
 * RODO: these are PURE functions over already-resolved lat/lng numbers. Callers own keeping the
 * INPUT coordinates (`Employee.homeLat/homeLng`) server-side only — this module never persists or
 * logs anything; it only returns numbers for the caller to round via {@link roundKm}/{@link
 * roundMinutes}/{@link roundCost} before any external (API/UI/audit) exposure.
 */

const EARTH_RADIUS_KM = 6371

/**
 * PURE great-circle (haversine) distance between two lat/lng points, in km (unrounded). See the
 * module doc — this is a straight-line estimate, not a road-routing distance.
 */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const a = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

/**
 * Estimated travel time in minutes (unrounded) for `km` at a constant `avgSpeedKmh` — no
 * traffic/routing model. Throws on a non-positive speed (a misconfigured policy must fail loudly,
 * not silently divide by zero into `Infinity`).
 */
export function travelMinutes(km: number, avgSpeedKmh: number): number {
  if (avgSpeedKmh <= 0) throw new Error('avgSpeedKmh must be > 0')
  return (km / avgSpeedKmh) * 60
}

/**
 * Estimated travel cost ("kilometrówka"), Decimal-safe (unrounded — see {@link roundCost} for
 * display). `roundTrip` doubles the one-way `km` before pricing (there-and-back); `false` prices the
 * one-way leg only.
 */
export function travelCost(km: number, perKmPln: number | DecimalLike, roundTrip: boolean): DecimalLike {
  const distance = new Decimal(km).mul(roundTrip ? 2 : 1)
  return distance.mul(perKmPln)
}

/**
 * Rounds a km distance to the nearest whole km — the RODO-safe form for any external (API/UI/audit)
 * surface. Never expose the unrounded float or the coordinates it was derived from.
 */
export function roundKm(km: number): number {
  return Math.round(km)
}

/** Rounds minutes to the nearest whole minute — the RODO-safe display form (see {@link roundKm}). */
export function roundMinutes(minutes: number): number {
  return Math.round(minutes)
}

/**
 * Rounds a money amount to 2dp, Decimal-safe — the RODO-safe display form (see {@link roundKm}).
 * Accepts either a plain number or a `Decimal` (e.g. {@link travelCost}'s return value).
 */
export function roundCost(cost: number | DecimalLike): DecimalLike {
  return new Decimal(cost).toDecimalPlaces(2)
}
