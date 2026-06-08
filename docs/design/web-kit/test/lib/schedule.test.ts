import { describe, it, expect, beforeEach } from 'vitest'
import {
  startOfWeek,
  addDays,
  ymd,
  weekDates,
  formatDayDate,
  minutesOf,
  shiftHours,
  employeeWeekHours,
  materializeWeek,
  SEED_SHIFTS,
  addShift,
  removeShift,
  updateShift,
  getShifts,
  resetShifts,
  type Shift,
} from '@/lib/schedule'

describe('schedule date math', () => {
  it('startOfWeek returns the Monday of the week', () => {
    const wed = new Date(2026, 5, 3) // some Wednesday-ish day in June 2026
    const mon = startOfWeek(wed)
    expect(mon.getDay()).toBe(1) // Monday
    expect(mon.getTime()).toBeLessThanOrEqual(wed.getTime())
    expect(addDays(mon, 6).getTime()).toBeGreaterThanOrEqual(wed.getTime())
  })

  it('ymd + addDays format local dates', () => {
    expect(ymd(new Date(2026, 5, 1))).toBe('2026-06-01')
    expect(ymd(addDays(new Date(2026, 5, 1), 3))).toBe('2026-06-04')
  })

  it('weekDates spans Mon..Sun', () => {
    const mon = startOfWeek(new Date(2026, 5, 3))
    const days = weekDates(mon)
    expect(days).toHaveLength(7)
    expect(days[0].getDay()).toBe(1) // Mon
    expect(days[6].getDay()).toBe(0) // Sun
    expect(formatDayDate(new Date(2026, 5, 1))).toBe('1.6')
  })
})

describe('schedule hours', () => {
  it('parses + sums shift hours', () => {
    expect(minutesOf('08:30')).toBe(510)
    expect(shiftHours({ start: '06:00', end: '14:00' })).toBe(8)
    const shifts: Shift[] = [
      { id: 'a', employeeId: '1', facilityId: 'f1', date: '2026-06-01', start: '08:00', end: '16:00' },
      { id: 'b', employeeId: '1', facilityId: 'f1', date: '2026-06-03', start: '08:00', end: '12:00' },
      { id: 'c', employeeId: '2', facilityId: 'f1', date: '2026-06-01', start: '08:00', end: '16:00' },
    ]
    expect(employeeWeekHours(shifts, '1')).toBe(12)
    expect(employeeWeekHours(shifts, '2')).toBe(8)
  })
})

describe('shift mutations (in-memory store)', () => {
  beforeEach(() => {
    resetShifts()
  })

  it('getShifts returns empty array initially', () => {
    expect(getShifts()).toEqual([])
  })

  it('addShift stores a shift and returns it with a generated id', () => {
    const shift = addShift({
      employeeId: '1',
      facilityId: 'f1',
      date: '2026-06-02',
      start: '08:00',
      end: '16:00',
    })
    expect(shift.id).toBeTruthy()
    expect(shift.employeeId).toBe('1')
    expect(shift.facilityId).toBe('f1')
    expect(shift.date).toBe('2026-06-02')
    expect(shift.start).toBe('08:00')
    expect(shift.end).toBe('16:00')
    expect(getShifts()).toHaveLength(1)
  })

  it('addShift generates unique ids for multiple shifts', () => {
    const a = addShift({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', start: '08:00', end: '16:00' })
    const b = addShift({ employeeId: '2', facilityId: 'f1', date: '2026-06-02', start: '09:00', end: '17:00' })
    expect(a.id).not.toBe(b.id)
    expect(getShifts()).toHaveLength(2)
  })

  it('removeShift deletes an existing shift and returns true', () => {
    const shift = addShift({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', start: '08:00', end: '16:00' })
    const removed = removeShift(shift.id)
    expect(removed).toBe(true)
    expect(getShifts()).toHaveLength(0)
  })

  it('removeShift returns false for unknown id', () => {
    const removed = removeShift('nonexistent')
    expect(removed).toBe(false)
  })

  it('updateShift patches an existing shift', () => {
    const shift = addShift({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', start: '08:00', end: '16:00' })
    const updated = updateShift(shift.id, { start: '09:00', end: '17:00' })
    expect(updated).toBeDefined()
    expect(updated!.start).toBe('09:00')
    expect(updated!.end).toBe('17:00')
    expect(updated!.employeeId).toBe('1') // unchanged fields preserved
    // store is updated
    expect(getShifts()[0].start).toBe('09:00')
  })

  it('updateShift returns undefined for unknown id', () => {
    const result = updateShift('nonexistent', { start: '10:00' })
    expect(result).toBeUndefined()
  })

  it('getShifts filters by facilityId', () => {
    addShift({ employeeId: '1', facilityId: 'f1', date: '2026-06-02', start: '08:00', end: '16:00' })
    addShift({ employeeId: '2', facilityId: 'f2', date: '2026-06-02', start: '06:00', end: '14:00' })
    const f1Only = getShifts('f1')
    expect(f1Only).toHaveLength(1)
    expect(f1Only[0].facilityId).toBe('f1')
  })

  it('getShifts filters by weekStart', () => {
    addShift({ employeeId: '1', facilityId: 'f1', date: '2026-06-01', start: '08:00', end: '16:00' })
    addShift({ employeeId: '2', facilityId: 'f1', date: '2026-06-08', start: '08:00', end: '16:00' })
    const week1 = getShifts(undefined, '2026-06-01') // Mon June 1
    expect(week1).toHaveLength(1)
    expect(week1[0].date).toBe('2026-06-01')
  })
})

describe('materializeWeek', () => {
  it('dates the seed onto a given week and filters by facility', () => {
    const mon = startOfWeek(new Date(2026, 5, 3))
    const f1 = materializeWeek(SEED_SHIFTS, mon, 'f1')
    expect(f1.length).toBe(SEED_SHIFTS.filter((s) => s.facilityId === 'f1').length)
    expect(f1.every((s) => s.facilityId === 'f1')).toBe(true)
    // a Monday (dayIndex 0) seed lands on the week's Monday
    const mondayShift = f1.find((s) => s.start === '08:00')
    expect(mondayShift?.date).toBe(ymd(mon))
  })
})
