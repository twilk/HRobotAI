import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayOfMonth,
  formatWeekRange,
  isoDate,
  mondayOf,
  normalizeDate,
  shiftWeek,
  shortName,
  weekDates,
  WEEKDAY_LABELS,
  type Employee,
} from './grafik'

describe('isoDate / normalizeDate', () => {
  it('formats a Date to YYYY-MM-DD in UTC', () => {
    expect(isoDate(new Date('2026-07-09T14:30:00.000Z'))).toBe('2026-07-09')
  })

  it('normalises both bare dates and @db.Date datetimes', () => {
    expect(normalizeDate('2026-07-06')).toBe('2026-07-06')
    expect(normalizeDate('2026-07-06T00:00:00.000Z')).toBe('2026-07-06')
  })
})

describe('mondayOf', () => {
  it('returns the same day when given a Monday', () => {
    // 2026-07-06 is a Monday.
    expect(isoDate(mondayOf(new Date('2026-07-06T00:00:00.000Z')))).toBe('2026-07-06')
  })

  it('snaps a mid-week day back to its Monday', () => {
    // 2026-07-09 is a Thursday.
    expect(isoDate(mondayOf(new Date('2026-07-09T09:00:00.000Z')))).toBe('2026-07-06')
  })

  it('treats Sunday as the end of the same ISO week (Monday start)', () => {
    // 2026-07-12 is a Sunday → its week starts Mon 2026-07-06.
    expect(isoDate(mondayOf(new Date('2026-07-12T23:59:00.000Z')))).toBe('2026-07-06')
  })
})

describe('addDays / weekDates', () => {
  it('adds days across a month boundary', () => {
    expect(isoDate(addDays(new Date('2026-07-31T00:00:00.000Z'), 1))).toBe('2026-08-01')
  })

  it('produces 7 consecutive ISO dates Mon→Sun', () => {
    const days = weekDates('2026-07-06')
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-07-06')
    expect(days[6]).toBe('2026-07-12')
    expect(WEEKDAY_LABELS).toHaveLength(7)
  })
})

describe('shiftWeek', () => {
  it('moves forward and backward by whole weeks', () => {
    expect(shiftWeek('2026-07-06', 1)).toBe('2026-07-13')
    expect(shiftWeek('2026-07-06', -1)).toBe('2026-06-29')
  })
})

describe('dayOfMonth', () => {
  it('reads the day component', () => {
    expect(dayOfMonth('2026-07-06')).toBe(6)
    expect(dayOfMonth('2026-07-31')).toBe(31)
  })
})

describe('formatWeekRange', () => {
  it('collapses month + year within one month', () => {
    expect(formatWeekRange('2026-07-06')).toBe('6–12 lipca 2026')
  })

  it('spells out both months across a month boundary', () => {
    // Week of Mon 2026-06-29 spans into July.
    expect(formatWeekRange('2026-06-29')).toBe('29 czerwca – 5 lipca 2026')
  })

  it('spells out both years across a year boundary', () => {
    // Mon 2026-12-28 → Sun 2027-01-03.
    expect(formatWeekRange('2026-12-28')).toBe('28 grudnia 2026 – 3 stycznia 2027')
  })
})

describe('shortName', () => {
  const anna: Employee = { id: 'e1', firstName: 'Anna', lastName: 'Nowak', position: null, unitId: 'u1' }

  it('renders "First L." for a known employee', () => {
    expect(shortName(anna, 'e1')).toBe('Anna N.')
  })

  it('falls back to a short id when the employee is unknown', () => {
    expect(shortName(undefined, 'abcdef12-3456')).toBe('abcdef12')
  })
})
