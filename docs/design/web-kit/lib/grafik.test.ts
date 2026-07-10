import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayOfMonth,
  deriveGrafikMetrics,
  formatCommuteMinutes,
  formatHours,
  formatWeekRange,
  isoDate,
  mondayOf,
  normalizeDate,
  shiftDurationHours,
  shiftWeek,
  shortName,
  weekDates,
  WEEKDAY_LABELS,
  type Employee,
  type Shift,
  type SolveResult,
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

// --- J3 solve-metrics derivations ---------------------------------------------------------------

function makeShift(start: string, end: string): Shift {
  return {
    id: `s-${start}-${end}`,
    employeeId: 'e1',
    lokalizacjaId: 'l1',
    demandId: null,
    date: '2026-07-13',
    start,
    end,
    role: 'PIELEGNIARKA',
    source: 'AUTO',
  }
}

function makeResult(over: Partial<SolveResult> = {}): SolveResult {
  return {
    status: 'OPTIMAL',
    assignmentsCreated: 0,
    unmet: [],
    metrics: { commuteTotal: 0, etatDeviation: 0, fairnessScore: 0 },
    shifts: [],
    ...over,
  }
}

describe('shiftDurationHours', () => {
  it('computes the HH:mm span in hours', () => {
    expect(shiftDurationHours({ start: '08:00', end: '16:00' })).toBe(8)
    expect(shiftDurationHours({ start: '06:30', end: '14:00' })).toBe(7.5)
  })

  it('clamps a non-positive span to 0 (no overnight support here)', () => {
    expect(shiftDurationHours({ start: '10:00', end: '10:00' })).toBe(0)
    expect(shiftDurationHours({ start: '22:00', end: '06:00' })).toBe(0)
  })
})

describe('formatCommuteMinutes', () => {
  it('renders sub-hour values in minutes', () => {
    expect(formatCommuteMinutes(0)).toBe('0 min')
    expect(formatCommuteMinutes(45)).toBe('45 min')
  })

  it('renders whole and mixed hours', () => {
    expect(formatCommuteMinutes(120)).toBe('2 h')
    expect(formatCommuteMinutes(125)).toBe('2 h 5 min')
  })

  it('rounds fractional minutes to the nearest minute', () => {
    expect(formatCommuteMinutes(59.4)).toBe('59 min')
    expect(formatCommuteMinutes(59.6)).toBe('1 h')
  })
})

describe('formatHours', () => {
  it('drops the decimal for whole hours and uses a Polish comma otherwise', () => {
    expect(formatHours(40)).toBe('40 h')
    expect(formatHours(37.5)).toBe('37,5 h')
    expect(formatHours(0)).toBe('0 h')
  })
})

describe('deriveGrafikMetrics', () => {
  it('sums scheduled hours from result.shifts', () => {
    const result = makeResult({ shifts: [makeShift('08:00', '16:00'), makeShift('06:30', '14:00')] })
    expect(deriveGrafikMetrics(result, 10).scheduledHours).toBe(15.5)
    expect(deriveGrafikMetrics(result, 10).scheduledHoursLabel).toBe('15,5 h')
  })

  it('surfaces commute and etat deviation from metrics', () => {
    const result = makeResult({ metrics: { commuteTotal: 125, etatDeviation: 12, fairnessScore: 0 } })
    const m = deriveGrafikMetrics(result, 10)
    expect(m.commuteMinutes).toBe(125)
    expect(m.commuteLabel).toBe('2 h 5 min')
    expect(m.etatDeviationHours).toBe(12)
    expect(m.etatDeviationLabel).toBe('12 h')
  })

  it('computes coverage as filled / required', () => {
    const m = deriveGrafikMetrics(makeResult({ assignmentsCreated: 34 }), 40)
    expect(m.filled).toBe(34)
    expect(m.required).toBe(40)
    expect(m.coverageRatio).toBeCloseTo(0.85)
    expect(m.coveragePercent).toBe(85)
    expect(m.coverageLabel).toBe('85% · 34/40')
  })

  it('guards divide-by-zero → 0% when there are no demands', () => {
    const m = deriveGrafikMetrics(makeResult({ assignmentsCreated: 5 }), 0)
    expect(m.coverageRatio).toBe(0)
    expect(m.coveragePercent).toBe(0)
    expect(m.coverageLabel).toBe('0% · 5/0')
  })

  it('does NOT surface fairnessScore (M3 placeholder)', () => {
    const result = makeResult({ metrics: { commuteTotal: 10, etatDeviation: 2, fairnessScore: 99 } })
    const m = deriveGrafikMetrics(result, 5)
    expect(JSON.stringify(m)).not.toContain('fairness')
    expect(Object.values(m)).not.toContain(99)
    expect('fairnessScore' in m).toBe(false)
  })
})
