import { isoWeekRange, toMinutes, windowMinutes } from './week-range.util.js'

describe('toMinutes', () => {
  it('converts an HH:mm clock time to minutes-since-midnight', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('08:30')).toBe(510)
    expect(toMinutes('23:59')).toBe(1439)
  })
})

describe('windowMinutes', () => {
  it('returns the plain difference for a same-day window', () => {
    expect(windowMinutes('08:00', '16:00')).toBe(480)
  })

  it('wraps past midnight (+24h) for an overnight window where end < start', () => {
    expect(windowMinutes('22:00', '06:00')).toBe(8 * 60)
  })

  it('returns 0 (not 24h) when end === start', () => {
    expect(windowMinutes('08:00', '08:00')).toBe(0)
  })
})

describe('isoWeekRange', () => {
  it('anchors a Wednesday to the Monday..Monday half-open ISO week', () => {
    // 2026-07-15 is a Wednesday; the ISO week is Mon 2026-07-13 .. Sun 2026-07-19.
    const { weekStart, weekEndExcl } = isoWeekRange(new Date('2026-07-15T00:00:00.000Z'))

    expect(weekStart.toISOString()).toBe('2026-07-13T00:00:00.000Z')
    expect(weekEndExcl.toISOString()).toBe('2026-07-20T00:00:00.000Z')
  })

  it('anchors a Monday to itself', () => {
    const { weekStart, weekEndExcl } = isoWeekRange(new Date('2026-07-13T00:00:00.000Z'))

    expect(weekStart.toISOString()).toBe('2026-07-13T00:00:00.000Z')
    expect(weekEndExcl.toISOString()).toBe('2026-07-20T00:00:00.000Z')
  })

  it('anchors a Sunday to the PRECEDING Monday (ISO week wraps back, not forward)', () => {
    // 2026-07-19 is a Sunday; it belongs to the week starting 2026-07-13.
    const { weekStart, weekEndExcl } = isoWeekRange(new Date('2026-07-19T00:00:00.000Z'))

    expect(weekStart.toISOString()).toBe('2026-07-13T00:00:00.000Z')
    expect(weekEndExcl.toISOString()).toBe('2026-07-20T00:00:00.000Z')
  })

  it('produces a 7-day half-open range', () => {
    const { weekStart, weekEndExcl } = isoWeekRange(new Date('2026-01-01T00:00:00.000Z'))

    expect(weekEndExcl.getTime() - weekStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
