import { BadRequestException } from '@nestjs/common'
import {
  addDays,
  buildRange,
  businessDaysBetween,
  businessDaysInRange,
  dayKey,
  daysInclusive,
  intersectInclusive,
  isBusinessDay,
  median,
  monthBuckets,
  monthKey,
  parseIsoDate,
  ratio,
  round,
  weekKey,
} from './analityk.range.js'

const utc = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)

describe('analityk.range', () => {
  describe('parseIsoDate', () => {
    it('parses a YYYY-MM-DD string at UTC midnight', () => {
      const d = parseIsoDate('2026-06-01', 'od')
      expect(d.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    })

    it('rejects a malformed string', () => {
      expect(() => parseIsoDate('01.06.2026', 'od')).toThrow(BadRequestException)
      expect(() => parseIsoDate('2026-6-1', 'od')).toThrow(BadRequestException)
    })

    it('rejects a well-formed but impossible calendar date instead of rolling it over', () => {
      // Date.UTC(2026, 1, 30) would silently become 2026-03-02 — that must be a 400, not March.
      expect(() => parseIsoDate('2026-02-30', 'do')).toThrow(BadRequestException)
    })
  })

  describe('buildRange', () => {
    it('produces an inclusive range plus an exclusive upper bound one day later', () => {
      const range = buildRange('2026-06-01', '2026-06-14')
      expect(dayKey(range.from)).toBe('2026-06-01')
      expect(dayKey(range.toIncl)).toBe('2026-06-14')
      expect(dayKey(range.toExcl)).toBe('2026-06-15')
    })

    it('accepts a single-day range', () => {
      const range = buildRange('2026-06-01', '2026-06-01')
      expect(dayKey(range.toExcl)).toBe('2026-06-02')
    })

    it('rejects an inverted range rather than reporting an empty period', () => {
      expect(() => buildRange('2026-06-14', '2026-06-01')).toThrow(BadRequestException)
    })
  })

  describe('isBusinessDay / businessDaysBetween', () => {
    it('counts Mon–Fri and excludes Sat/Sun', () => {
      expect(isBusinessDay(utc('2026-06-01'))).toBe(true) // Monday
      expect(isBusinessDay(utc('2026-06-05'))).toBe(true) // Friday
      expect(isBusinessDay(utc('2026-06-06'))).toBe(false) // Saturday
      expect(isBusinessDay(utc('2026-06-07'))).toBe(false) // Sunday
    })

    it('counts exactly 10 working days across two full weeks (2026-06-01 is a Monday)', () => {
      expect(businessDaysBetween(utc('2026-06-01'), utc('2026-06-14'))).toBe(10)
    })

    it('counts 22 working days in June 2026', () => {
      expect(businessDaysBetween(utc('2026-06-01'), utc('2026-06-30'))).toBe(22)
    })

    it('returns 0 for an inverted range and for a weekend-only range', () => {
      expect(businessDaysBetween(utc('2026-06-14'), utc('2026-06-01'))).toBe(0)
      expect(businessDaysBetween(utc('2026-06-06'), utc('2026-06-07'))).toBe(0)
    })
  })

  describe('intersectInclusive / businessDaysInRange', () => {
    const range = { from: utc('2026-06-01'), toIncl: utc('2026-06-14') }

    it('clips a leave that starts before the range to the in-range portion only', () => {
      // 2026-05-28..2026-06-02 → only Mon 06-01 and Tue 06-02 fall inside.
      expect(businessDaysInRange(utc('2026-05-28'), utc('2026-06-02'), range)).toBe(2)
    })

    it('clips a leave that ends after the range', () => {
      // 2026-06-11..2026-06-20 → 06-11 Thu, 06-12 Fri (weekend skipped) = 2 working days in range.
      expect(businessDaysInRange(utc('2026-06-11'), utc('2026-06-20'), range)).toBe(2)
    })

    it('returns 0 for a disjoint interval and for a weekend-only leave', () => {
      expect(businessDaysInRange(utc('2026-07-01'), utc('2026-07-05'), range)).toBe(0)
      expect(businessDaysInRange(utc('2026-06-13'), utc('2026-06-14'), range)).toBe(0)
    })

    it('returns null from intersectInclusive when the intervals do not touch', () => {
      expect(intersectInclusive(utc('2026-01-01'), utc('2026-01-05'), utc('2026-02-01'), utc('2026-02-05'))).toBeNull()
    })
  })

  describe('weekKey', () => {
    it('anchors every day of a week to that week’s Monday', () => {
      expect(weekKey(utc('2026-06-01'))).toBe('2026-06-01') // Monday itself
      expect(weekKey(utc('2026-06-07'))).toBe('2026-06-01') // Sunday → previous Monday
      expect(weekKey(utc('2026-06-08'))).toBe('2026-06-08') // next Monday
    })
  })

  describe('monthBuckets / monthKey', () => {
    it('emits one bucket for a range inside a single month', () => {
      expect(monthBuckets({ from: utc('2026-06-01'), toIncl: utc('2026-06-14') })).toEqual(['2026-06'])
    })

    it('emits every month a range touches, including across a year boundary', () => {
      expect(monthBuckets({ from: utc('2025-11-20'), toIncl: utc('2026-02-03') })).toEqual([
        '2025-11',
        '2025-12',
        '2026-01',
        '2026-02',
      ])
    })

    it('keys a date to its YYYY-MM month', () => {
      expect(monthKey(utc('2026-06-14'))).toBe('2026-06')
    })
  })

  describe('median', () => {
    it('returns the middle value of an odd sample', () => {
      expect(median([6, 48, 12])).toBe(12)
    })

    it('averages the two middle values of an even sample', () => {
      expect(median([6, 12, 20, 48])).toBe(16)
    })

    it('returns null (not 0) for an empty sample — "no decisions" is not "instant decisions"', () => {
      expect(median([])).toBeNull()
    })
  })

  describe('ratio / round / daysInclusive / addDays', () => {
    it('returns null (not 0 or NaN) for a zero denominator', () => {
      expect(ratio(7, 0)).toBeNull()
    })

    it('rounds to 4 decimals by default', () => {
      expect(ratio(7, 30)).toBe(0.2333)
      expect(ratio(1, 3)).toBe(0.3333)
    })

    it('rounds to the requested precision', () => {
      expect(round(9.272727, 2)).toBe(9.27)
      expect(round(24.3333, 2)).toBe(24.33)
    })

    it('counts inclusive days and returns 0 for an inverted range', () => {
      expect(daysInclusive(utc('2026-06-01'), utc('2026-06-14'))).toBe(14)
      expect(daysInclusive(utc('2026-06-14'), utc('2026-06-01'))).toBe(0)
    })

    it('adds days in UTC', () => {
      expect(dayKey(addDays(utc('2026-06-30'), 1))).toBe('2026-07-01')
    })
  })
})
