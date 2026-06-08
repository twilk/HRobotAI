import { describe, it, expect, beforeEach } from 'vitest'
import {
  createShift,
  deleteShift,
  patchShift,
} from '@/lib/actions/grafik-actions'
import { getShifts, resetShifts } from '@/lib/schedule'

beforeEach(() => {
  resetShifts()
})

describe('createShift', () => {
  it('adds a shift to the store and returns success + id', async () => {
    const before = getShifts().length
    const result = await createShift({
      facilityId: 'f1',
      employeeId: 'emp-1',
      employeeName: 'Test Pracownik',
      weekStart: '2026-07-06',
      dayIndex: 0,
      startTime: '08:00',
      endTime: '16:00',
    })
    expect(result.success).toBe(true)
    expect(result.id).toBeTruthy()
    expect(getShifts().length).toBe(before + 1)
  })

  it('shift is retrievable in the store by facilityId', async () => {
    const result = await createShift({
      facilityId: 'f2',
      employeeId: 'emp-2',
      employeeName: 'Drugi Pracownik',
      weekStart: '2026-07-06',
      dayIndex: 2,
      startTime: '14:00',
      endTime: '22:00',
    })
    const shifts = getShifts('f2')
    expect(shifts.some((s) => s.id === result.id)).toBe(true)
    const stored = shifts.find((s) => s.id === result.id)
    expect(stored?.start).toBe('14:00')
    expect(stored?.end).toBe('22:00')
  })

  it('accepts optional role field', async () => {
    const result = await createShift({
      facilityId: 'f1',
      employeeId: 'emp-3',
      employeeName: 'Rola Test',
      weekStart: '2026-07-06',
      dayIndex: 1,
      startTime: '09:00',
      endTime: '17:00',
      role: 'Kierownik',
    })
    const shifts = getShifts('f1')
    const stored = shifts.find((s) => s.id === result.id)
    expect(stored?.role).toBe('Kierownik')
  })

  it('returns error when facilityId is missing', async () => {
    const result = await createShift({
      facilityId: '',
      employeeId: 'emp-4',
      employeeName: 'Test',
      weekStart: '2026-07-06',
      dayIndex: 0,
      startTime: '08:00',
      endTime: '16:00',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns error when employeeId is missing', async () => {
    const result = await createShift({
      facilityId: 'f1',
      employeeId: '',
      employeeName: 'Test',
      weekStart: '2026-07-06',
      dayIndex: 0,
      startTime: '08:00',
      endTime: '16:00',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('stores the correct date derived from weekStart + dayIndex', async () => {
    // weekStart: 2026-07-06 (Mon), dayIndex: 2 → Wed 2026-07-08
    const result = await createShift({
      facilityId: 'f3',
      employeeId: 'emp-5',
      employeeName: 'Date Test',
      weekStart: '2026-07-06',
      dayIndex: 2,
      startTime: '10:00',
      endTime: '18:00',
    })
    const shifts = getShifts('f3')
    const stored = shifts.find((s) => s.id === result.id)
    expect(stored?.date).toBe('2026-07-08')
  })
})

describe('deleteShift', () => {
  it('removes a shift from the store', async () => {
    const created = await createShift({
      facilityId: 'f1',
      employeeId: 'emp-del-1',
      employeeName: 'Delete Test',
      weekStart: '2026-07-06',
      dayIndex: 0,
      startTime: '08:00',
      endTime: '16:00',
    })
    expect(created.success).toBe(true)
    const before = getShifts().length
    const result = await deleteShift(created.id!)
    expect(result.success).toBe(true)
    expect(getShifts().length).toBe(before - 1)
  })

  it('returns error for unknown id', async () => {
    const result = await deleteShift('nonexistent-shift-xyz')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('patchShift', () => {
  it('updates shift fields', async () => {
    const created = await createShift({
      facilityId: 'f2',
      employeeId: 'emp-patch-1',
      employeeName: 'Patch Test',
      weekStart: '2026-07-06',
      dayIndex: 3,
      startTime: '06:00',
      endTime: '14:00',
    })
    const result = await patchShift(created.id!, { start: '07:00', end: '15:00' })
    expect(result.success).toBe(true)
    const shifts = getShifts('f2')
    const stored = shifts.find((s) => s.id === created.id)
    expect(stored?.start).toBe('07:00')
    expect(stored?.end).toBe('15:00')
  })

  it('returns error for unknown id', async () => {
    const result = await patchShift('nonexistent-xyz', { start: '09:00' })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
