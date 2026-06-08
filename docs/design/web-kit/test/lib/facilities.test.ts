import { describe, it, expect, beforeEach } from 'vitest'
import {
  getFacilities,
  getFacility,
  isOpen,
  formatDayHours,
  weeklyOpenHours,
  hoursBetween,
  updateFacilityHours,
  setFacilityHours,
  setFacilityAddress,
  resetFacilities,
} from '@/lib/facilities'

beforeEach(() => {
  resetFacilities()
})

describe('facilities lib', () => {
  it('lists facilities and looks up by id', () => {
    expect(getFacilities()).toHaveLength(3)
    expect(getFacility('f1')?.name).toBe('Centrala Warszawa')
    expect(getFacility('nope')).toBeUndefined()
  })

  it('knows open vs closed days', () => {
    const f1 = getFacility('f1')!
    expect(isOpen(f1, 0)).toBe(true) // Poniedziałek
    expect(isOpen(f1, 6)).toBe(false) // Niedziela — zamknięte
  })

  it('formats hours and computes weekly total', () => {
    expect(formatDayHours({ open: '08:00', close: '16:00' })).toBe('8:00–16:00')
    expect(formatDayHours(null)).toBe('Zamknięte')
    expect(hoursBetween('06:00', '22:00')).toBe(16)
    // f1: Pon–Pt 8h ×5 = 40 + Sob 4h = 44
    expect(weeklyOpenHours(getFacility('f1')!)).toBe(44)
  })

  it('updates one day immutably', () => {
    const f1 = getFacility('f1')!
    const next = updateFacilityHours(f1, 6, { open: '10:00', close: '14:00' })
    expect(next.hours[6]).toEqual({ open: '10:00', close: '14:00' })
    expect(f1.hours[6]).toBeNull() // original untouched
    expect(next).not.toBe(f1)
  })
})

describe('setFacilityHours (store mutation)', () => {
  it('updates the weekly hours for a known facility and returns updated facility', () => {
    const newHours: import('@/lib/facilities').WeeklyHours = [
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      { open: '09:00', close: '17:00' },
      null,
      null,
    ]
    const updated = setFacilityHours('f1', newHours)
    expect(updated).toBeDefined()
    expect(updated!.hours[0]).toEqual({ open: '09:00', close: '17:00' })
    expect(updated!.hours[5]).toBeNull()
  })

  it('persists the change — getFacility reflects updated hours', () => {
    const newHours: import('@/lib/facilities').WeeklyHours = [
      null, null, null, null, null, null, null,
    ]
    setFacilityHours('f2', newHours)
    expect(getFacility('f2')?.hours[0]).toBeNull()
  })

  it('returns undefined for an unknown facilityId', () => {
    const newHours: import('@/lib/facilities').WeeklyHours = [
      null, null, null, null, null, null, null,
    ]
    expect(setFacilityHours('nonexistent', newHours)).toBeUndefined()
  })
})

describe('setFacilityAddress (store mutation)', () => {
  it('updates address fields for a known facility and returns updated facility', () => {
    const updated = setFacilityAddress('f1', { street: 'ul. Nowa 99' })
    expect(updated).toBeDefined()
    expect(updated!.address.street).toBe('ul. Nowa 99')
    expect(updated!.address.city).toBe('Warszawa') // unchanged
  })

  it('persists the change — getFacility reflects updated address', () => {
    setFacilityAddress('f3', { postalCode: '99-999' })
    expect(getFacility('f3')?.address.postalCode).toBe('99-999')
  })

  it('returns undefined for an unknown facilityId', () => {
    expect(setFacilityAddress('nonexistent', { city: 'X' })).toBeUndefined()
  })

  it('resetFacilities restores original data', () => {
    setFacilityAddress('f1', { street: 'ul. Zmieniona 1' })
    resetFacilities()
    expect(getFacility('f1')?.address.street).toBe('ul. Prosta 12')
  })
})
