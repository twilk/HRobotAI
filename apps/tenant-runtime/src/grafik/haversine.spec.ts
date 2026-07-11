import { ASSUMED_COMMUTE_KMH, commuteMinutes, haversineKm } from './haversine.js'

describe('haversine', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 52, lng: 21 }, { lat: 52, lng: 21 })).toBe(0)
    expect(commuteMinutes({ lat: 52, lng: 21 }, { lat: 52, lng: 21 })).toBe(0)
  })

  it('matches a known great-circle distance (~111 km per degree of latitude)', () => {
    const km = haversineKm({ lat: 52, lng: 21 }, { lat: 53, lng: 21 })
    expect(km).toBeGreaterThan(110)
    expect(km).toBeLessThan(112)
  })

  it('is symmetric', () => {
    const a = { lat: 50.06, lng: 19.94 } // Kraków
    const b = { lat: 52.23, lng: 21.01 } // Warszawa
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9)
  })

  it('derives minutes from distance at the assumed commute speed', () => {
    const a = { lat: 52, lng: 21 }
    const b = { lat: 53, lng: 21 }
    const expected = (haversineKm(a, b) / ASSUMED_COMMUTE_KMH) * 60
    expect(commuteMinutes(a, b)).toBeCloseTo(expected, 9)
  })
})
