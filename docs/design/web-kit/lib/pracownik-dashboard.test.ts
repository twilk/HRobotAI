import { describe, expect, it } from 'vitest'
import {
  shiftHours,
  weekRange,
  upcomingShifts,
  hoursInRange,
  weeklyTargetHours,
  leaveSummary,
  fmtShiftDay,
} from './pracownik-dashboard'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — these cover only the pure
// helpers the PRACOWNIK dashboard board relies on (no network, no PII, no DOM).

describe('shiftHours', () => {
  it('computes a normal same-day shift', () => {
    expect(shiftHours('06:00', '14:00')).toBe(8)
  })

  it('adds 24h for an overnight shift (end < start)', () => {
    expect(shiftHours('22:00', '06:00')).toBe(8)
  })

  it('returns 0 when start === end', () => {
    expect(shiftHours('09:00', '09:00')).toBe(0)
  })

  it('handles partial-hour shifts', () => {
    expect(shiftHours('06:00', '14:30')).toBe(8.5)
  })
})

describe('weekRange', () => {
  it('returns the same Mon..Sun span when given a Monday', () => {
    // 2026-07-13 is a Monday
    expect(weekRange('2026-07-13')).toEqual({ from: '2026-07-13', to: '2026-07-19' })
  })

  it('returns the containing Mon..Sun span when given a Sunday', () => {
    // 2026-07-19 is the Sunday of the same week
    expect(weekRange('2026-07-19')).toEqual({ from: '2026-07-13', to: '2026-07-19' })
  })

  it('returns the containing week for a midweek date', () => {
    // 2026-07-16 is a Thursday
    expect(weekRange('2026-07-16')).toEqual({ from: '2026-07-13', to: '2026-07-19' })
  })
})

describe('upcomingShifts', () => {
  const shifts = [
    { id: 'past', date: '2026-07-01', start: '08:00' },
    { id: 'today-late', date: '2026-07-13', start: '14:00' },
    { id: 'today-early', date: '2026-07-13', start: '06:00' },
    { id: 'future-1', date: '2026-07-14', start: '10:00' },
    { id: 'future-2', date: '2026-07-15', start: '10:00' },
    { id: 'future-3', date: '2026-07-16', start: '10:00' },
    { id: 'future-4', date: '2026-07-17', start: '10:00' },
  ]

  it('filters out shifts before today', () => {
    const result = upcomingShifts(shifts, '2026-07-13')
    expect(result.find((s) => s.id === 'past')).toBeUndefined()
  })

  it('sorts by date then start time', () => {
    const result = upcomingShifts(shifts, '2026-07-13')
    expect(result.map((s) => s.id)).toEqual([
      'today-early',
      'today-late',
      'future-1',
      'future-2',
      'future-3',
    ])
  })

  it('limits to the given count (default 5)', () => {
    const result = upcomingShifts(shifts, '2026-07-13')
    expect(result).toHaveLength(5)
  })

  it('respects a custom limit', () => {
    const result = upcomingShifts(shifts, '2026-07-13', 2)
    expect(result.map((s) => s.id)).toEqual(['today-early', 'today-late'])
  })

  it('normalizes a full ISO datetime date field before comparing', () => {
    const withDatetime = [{ id: 'a', date: '2026-07-20T00:00:00.000Z', start: '08:00' }]
    expect(upcomingShifts(withDatetime, '2026-07-13')).toHaveLength(1)
  })
})

describe('hoursInRange', () => {
  const shifts = [
    { date: '2026-07-12', start: '06:00', end: '14:00' }, // outside range (before)
    { date: '2026-07-13', start: '06:00', end: '14:00' }, // 8h
    { date: '2026-07-15', start: '22:00', end: '06:00' }, // overnight, 8h
    { date: '2026-07-19', start: '09:00', end: '17:30' }, // 8.5h
    { date: '2026-07-20', start: '06:00', end: '14:00' }, // outside range (after)
  ]

  it('sums shift hours within [from, to] inclusive', () => {
    expect(hoursInRange(shifts, '2026-07-13', '2026-07-19')).toBe(24.5)
  })

  it('returns 0 for an empty shift list', () => {
    expect(hoursInRange([], '2026-07-13', '2026-07-19')).toBe(0)
  })

  it('returns 0 when no shift falls in range', () => {
    expect(hoursInRange(shifts, '2026-08-01', '2026-08-07')).toBe(0)
  })
})

describe('weeklyTargetHours', () => {
  it('etat "1" -> 40', () => {
    expect(weeklyTargetHours('1')).toBe(40)
  })

  it('etat "0.5" -> 20', () => {
    expect(weeklyTargetHours('0.5')).toBe(20)
  })

  it('numeric etat is accepted directly', () => {
    expect(weeklyTargetHours(0.75)).toBe(30)
  })

  it('malformed etat -> 0', () => {
    expect(weeklyTargetHours('not-a-number')).toBe(0)
  })

  it('empty etat -> 0', () => {
    expect(weeklyTargetHours('')).toBe(0)
  })
})

describe('leaveSummary', () => {
  it('counts leaves by status', () => {
    const leaves = [
      { status: 'APPROVED' },
      { status: 'APPROVED' },
      { status: 'PENDING' },
      { status: 'REJECTED' },
      { status: 'APPROVED' },
    ]
    expect(leaveSummary(leaves)).toEqual({ approved: 3, pending: 1, rejected: 1 })
  })

  it('returns all-zero counts for an empty list', () => {
    expect(leaveSummary([])).toEqual({ approved: 0, pending: 0, rejected: 0 })
  })

  it('ignores statuses outside the three tracked buckets', () => {
    expect(leaveSummary([{ status: 'CANCELLED' }])).toEqual({ approved: 0, pending: 0, rejected: 0 })
  })
})

describe('fmtShiftDay', () => {
  it('formats a Monday', () => {
    expect(fmtShiftDay('2026-07-13')).toBe('pon 13.07')
  })

  it('formats a date given as a full ISO datetime', () => {
    expect(fmtShiftDay('2026-10-04T00:00:00.000Z')).toBe('nd 04.10')
  })

  it('formats a Saturday', () => {
    // 2026-07-18 is a Saturday
    expect(fmtShiftDay('2026-07-18')).toBe('sob 18.07')
  })
})
