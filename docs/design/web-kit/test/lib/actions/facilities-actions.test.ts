import { describe, it, expect, beforeEach } from 'vitest'
import {
  updateFacilityHours,
  updateFacilityAddress,
} from '@/lib/actions/facilities-actions'
import { getFacility, resetFacilities, type WeeklyHours, type DayHours } from '@/lib/facilities'

beforeEach(() => {
  resetFacilities()
})

describe('updateFacilityHours', () => {
  it('persists new weekly hours for a known facility', async () => {
    const hours: WeeklyHours = [
      { open: '07:00', close: '15:00' },
      { open: '07:00', close: '15:00' },
      { open: '07:00', close: '15:00' },
      { open: '07:00', close: '15:00' },
      { open: '07:00', close: '15:00' },
      null,
      null,
    ]
    const result = await updateFacilityHours('f1', hours)
    expect(result.success).toBe(true)
    const facility = getFacility('f1')
    expect(facility?.hours[0]?.open).toBe('07:00')
    expect(facility?.hours[0]?.close).toBe('15:00')
    expect(facility?.hours[5]).toBeNull()
  })

  it('can set a day to null (closed)', async () => {
    const original = getFacility('f1')!
    const hours: WeeklyHours = [...original.hours] as WeeklyHours
    hours[0] = null
    const result = await updateFacilityHours('f1', hours)
    expect(result.success).toBe(true)
    expect(getFacility('f1')?.hours[0]).toBeNull()
  })

  it('returns error for unknown facility id', async () => {
    const hours: WeeklyHours = [null, null, null, null, null, null, null]
    const result = await updateFacilityHours('nonexistent-facility', hours)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('updateFacilityAddress', () => {
  it('persists address changes for a known facility', async () => {
    const result = await updateFacilityAddress('f2', {
      street: 'ul. Nowa 99',
      city: 'Pruszków',
      zip: '05-800',
    })
    expect(result.success).toBe(true)
    const facility = getFacility('f2')
    expect(facility?.address.street).toBe('ul. Nowa 99')
    expect(facility?.address.postalCode).toBe('05-800')
  })

  it('partial update does not overwrite untouched fields', async () => {
    const before = getFacility('f1')!.address.city
    const result = await updateFacilityAddress('f1', {
      street: 'ul. Zmieniona 1',
    })
    expect(result.success).toBe(true)
    const facility = getFacility('f1')
    expect(facility?.address.street).toBe('ul. Zmieniona 1')
    expect(facility?.address.city).toBe(before)
  })

  it('returns error for unknown facility id', async () => {
    const result = await updateFacilityAddress('nonexistent-facility', {
      street: 'ul. Nowa 1',
      city: 'Warszawa',
      zip: '00-001',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
