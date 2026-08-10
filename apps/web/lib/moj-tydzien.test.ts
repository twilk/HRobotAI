import { describe, expect, it } from 'vitest'
import { addDays, dayLabel, groupByDay, nextShiftAfterWeek, todayIso, weekDays, type WeekShift } from './moj-tydzien'

const shift = (id: string, date: string, start: string, end = '16:00'): WeekShift => ({ id, date, start, end })

describe('weekDays', () => {
  it('returns Monday-first, seven days, for a mid-week day', () => {
    // 2026-03-12 is a Thursday.
    expect(weekDays('2026-03-12')).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
      '2026-03-15',
    ])
  })

  it('treats Sunday as the END of its week, not the start', () => {
    // The bug every week-picker ships once: JS getDay() makes Sunday 0, so a naive implementation
    // rolls Sunday forward into the NEXT week and an employee checking their roster on Sunday
    // evening sees the wrong seven days.
    expect(weekDays('2026-03-15')[0]).toBe('2026-03-09')
    expect(weekDays('2026-03-15')[6]).toBe('2026-03-15')
  })

  it('handles a Monday as its own week start', () => {
    expect(weekDays('2026-03-09')[0]).toBe('2026-03-09')
  })

  it('crosses a month and a year boundary', () => {
    expect(weekDays('2026-04-01')).toContain('2026-03-30')
    expect(weekDays('2027-01-01')).toContain('2026-12-28')
  })
})

describe('addDays', () => {
  it('crosses month, year and leap-day boundaries without drifting', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    // 2028 is a leap year — parsing as UTC keeps this exact.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('dayLabel', () => {
  it('names the weekday and the day in the Polish genitive', () => {
    expect(dayLabel('2026-03-12')).toEqual({ weekday: 'Czwartek', dayLabel: '12 marca' })
    expect(dayLabel('2026-09-01')).toEqual({ weekday: 'Wtorek', dayLabel: '1 września' })
  })
})

describe('groupByDay', () => {
  it('keeps empty days — "not working Thursday" is information', () => {
    const groups = groupByDay([shift('a', '2026-03-09', '08:00')], '2026-03-12')

    expect(groups).toHaveLength(7)
    expect(groups[0]!.shifts).toHaveLength(1)
    expect(groups[3]!.shifts).toEqual([])
  })

  it('orders shifts within a day by start time', () => {
    const groups = groupByDay(
      [shift('late', '2026-03-12', '14:00'), shift('early', '2026-03-12', '06:00')],
      '2026-03-12',
    )
    const thursday = groups.find((g) => g.date === '2026-03-12')!

    expect(thursday.shifts.map((s) => s.id)).toEqual(['early', 'late'])
  })

  it('drops shifts outside the week rather than mislabelling them', () => {
    // /api/grafik/shifts returns more than one week; a shift from next month must not be rendered
    // under one of this week's day headers.
    const groups = groupByDay([shift('next-month', '2026-04-20', '08:00')], '2026-03-12')

    expect(groups.flatMap((g) => g.shifts)).toEqual([])
  })

  it('marks exactly one day as today', () => {
    const groups = groupByDay([], '2026-03-12')

    expect(groups.filter((g) => g.isToday).map((g) => g.date)).toEqual(['2026-03-12'])
  })

  it('returns the full week even with no shifts at all', () => {
    expect(groupByDay([], '2026-03-12')).toHaveLength(7)
  })

  it('matches shifts whose date is a full ISO datetime, as /api/grafik/shifts actually returns', () => {
    // Regression: the real API returns "2026-03-12T00:00:00.000Z", not "2026-03-12". Comparing the
    // raw string against the bare YYYY-MM-DD days array silently dropped every shift, every week.
    const groups = groupByDay([shift('a', '2026-03-12T00:00:00.000Z', '08:00')], '2026-03-12')
    const thursday = groups.find((g) => g.date === '2026-03-12')!

    expect(thursday.shifts).toHaveLength(1)
  })
})

describe('todayIso', () => {
  it('uses LOCAL calendar date, not UTC', () => {
    // 23:30 on the 12th in a UTC+2 zone is still the 12th for the person holding the phone, even
    // though UTC has already rolled to the 13th. Getting this wrong shows tomorrow's roster tonight.
    const late = new Date(2026, 2, 12, 23, 30, 0)
    expect(todayIso(late)).toBe('2026-03-12')
  })

  it('zero-pads month and day', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

// Regresja 2026-08-10: pracownik z pustym tygodniem widzial siedem razy „Wolne" i nic wiecej — nie
// wiedzial, czy naprawde nie ma pracy, czy dane sie nie wczytaly. Jego wlasny pulpit znal najblizsza
// zmiane; ten ekran jej nie pokazywal.
describe('nextShiftAfterWeek', () => {
  const s = (id: string, date: string, start = '08:00'): WeekShift => ({ id, date, start, end: '16:00' })

  it('zwraca najblizsza zmiane PO biezacym tygodniu', () => {
    // 2026-03-12 to czwartek; tydzien konczy sie 2026-03-15.
    const r = nextShiftAfterWeek([s('p', '2026-03-20'), s('b', '2026-04-02')], '2026-03-12')
    expect(r?.id).toBe('p')
  })

  it('IGNORUJE zmiany z biezacego tygodnia — te sa juz widoczne w siatce', () => {
    expect(nextShiftAfterWeek([s('w-tym-tyg', '2026-03-14')], '2026-03-12')).toBeNull()
  })

  it('IGNORUJE przeszlosc — „nastepna" z definicji jeszcze nie nastapila', () => {
    expect(nextShiftAfterWeek([s('stara', '2026-01-05')], '2026-03-12')).toBeNull()
  })

  it('przy kilku tego samego dnia wybiera te, ktora zaczyna sie wczesniej', () => {
    const r = nextShiftAfterWeek([s('pozna', '2026-03-20', '14:00'), s('wczesna', '2026-03-20', '06:00')], '2026-03-12')
    expect(r?.id).toBe('wczesna')
  })

  it('radzi sobie z pelnym ISO-timestampem, tak jak zwraca API', () => {
    expect(nextShiftAfterWeek([s('p', '2026-03-20T00:00:00.000Z')], '2026-03-12')?.id).toBe('p')
  })

  it('zwraca null dla pustej listy', () => {
    expect(nextShiftAfterWeek([], '2026-03-12')).toBeNull()
  })
})
