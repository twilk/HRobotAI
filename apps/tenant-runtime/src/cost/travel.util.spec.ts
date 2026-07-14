import { TenantPrisma } from '@hrobot/db'
import { haversineKm, travelMinutes, travelCost, roundKm, roundMinutes, roundCost } from './travel.util.js'

const { Decimal } = TenantPrisma

// Known city pairs (straight-line, "szacunkowy dojazd (demo)" — expect a real-world-ish ballpark,
// not exact road distance).
const WARSZAWA = { lat: 52.2297, lng: 21.0122 }
const KRAKOW = { lat: 50.0647, lng: 19.945 }
const CHOPIN_AIRPORT = { lat: 52.1657, lng: 20.9671 } // ~9km SW of central Warszawa

describe('haversineKm', () => {
  it('is 0 for the same point', () => {
    expect(haversineKm(WARSZAWA.lat, WARSZAWA.lng, WARSZAWA.lat, WARSZAWA.lng)).toBeCloseTo(0, 5)
  })

  it('Warszawa <-> Krakow is roughly 250-300km straight-line', () => {
    const km = haversineKm(WARSZAWA.lat, WARSZAWA.lng, KRAKOW.lat, KRAKOW.lng)
    expect(km).toBeGreaterThan(250)
    expect(km).toBeLessThan(300)
  })

  it('is symmetric (A->B === B->A)', () => {
    const ab = haversineKm(WARSZAWA.lat, WARSZAWA.lng, KRAKOW.lat, KRAKOW.lng)
    const ba = haversineKm(KRAKOW.lat, KRAKOW.lng, WARSZAWA.lat, WARSZAWA.lng)
    expect(ab).toBeCloseTo(ba, 9)
  })

  it('a short intra-city hop (Warszawa center <-> Chopin airport) is single-digit km', () => {
    const km = haversineKm(WARSZAWA.lat, WARSZAWA.lng, CHOPIN_AIRPORT.lat, CHOPIN_AIRPORT.lng)
    expect(km).toBeGreaterThan(1)
    expect(km).toBeLessThan(15)
  })
})

describe('travelMinutes', () => {
  it('divides distance by speed and converts to minutes', () => {
    expect(travelMinutes(60, 60)).toBeCloseTo(60, 9) // 60km at 60km/h = 1h = 60min
    expect(travelMinutes(30, 60)).toBeCloseTo(30, 9)
    expect(travelMinutes(100, 50)).toBeCloseTo(120, 9)
  })

  it('throws on a non-positive avgSpeedKmh instead of dividing by zero', () => {
    expect(() => travelMinutes(10, 0)).toThrow('avgSpeedKmh must be > 0')
    expect(() => travelMinutes(10, -5)).toThrow('avgSpeedKmh must be > 0')
  })
})

describe('travelCost', () => {
  it('prices a round trip as 2x the one-way distance', () => {
    const cost = travelCost(10, 1.15, true)
    expect(cost).toBeInstanceOf(Decimal)
    expect(cost.toNumber()).toBeCloseTo(23, 9) // 10km * 2 * 1.15
  })

  it('prices a one-way trip without doubling', () => {
    const cost = travelCost(10, 1.15, false)
    expect(cost.toNumber()).toBeCloseTo(11.5, 9)
  })

  it('accepts a Decimal perKmPln input', () => {
    const cost = travelCost(4, new Decimal('1.15'), true)
    expect(cost.toNumber()).toBeCloseTo(9.2, 9)
  })

  it('is 0 for 0km', () => {
    expect(travelCost(0, 1.15, true).toNumber()).toBe(0)
  })
})

describe('roundKm / roundMinutes / roundCost', () => {
  it('roundKm rounds to the nearest whole km', () => {
    expect(roundKm(6.4)).toBe(6)
    expect(roundKm(6.5)).toBe(7)
    expect(roundKm(6.6)).toBe(7)
  })

  it('roundMinutes rounds to the nearest whole minute', () => {
    expect(roundMinutes(4.4)).toBe(4)
    expect(roundMinutes(4.5)).toBe(5)
  })

  it('roundCost rounds to 2dp and stays Decimal-safe', () => {
    const rounded = roundCost(9.206)
    expect(rounded).toBeInstanceOf(Decimal)
    expect(rounded.toFixed(2)).toBe('9.21')
  })

  it('roundCost accepts a Decimal input', () => {
    const rounded = roundCost(new Decimal('16.324'))
    expect(rounded.toFixed(2)).toBe('16.32')
  })
})
