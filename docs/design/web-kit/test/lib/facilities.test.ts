import { describe, it, expect } from 'vitest'
import {
  getFacilities,
  getFacility,
  isOpen,
  formatDayHours,
  weeklyOpenHours,
  hoursBetween,
  updateFacilityHours,
} from '@/lib/facilities'

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
