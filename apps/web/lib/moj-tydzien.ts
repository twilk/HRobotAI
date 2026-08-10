// Pure helpers for the employee's mobile week view.
//
// WHY THERE IS A MOBILE ROUTE AT ALL. The product's end user is a shift worker — 4Mobility's staff
// stand next to a car, not a desk — and the app was built desktop-first: 31 responsive breakpoint
// usages across apps/web against 47 hardcoded pixel widths. Making all nineteen thousand lines
// responsive is not a two-week job and mostly would not pay: managers and HR genuinely do work at a
// desk. What a shift worker needs is two things — when am I working, and can I ask for time off.
// That is this route, and deliberately nothing else.
//
// The eleven other screens stay desktop-only on purpose. Widening this route beyond the two answers
// above should be a decision made on evidence (the usage events from lib/usage-log.ts will say
// whether anybody opens it at all), not a reflex.

/** A shift as the grafik API returns it, narrowed to what this view needs. */
export interface WeekShift {
  id: string
  date: string
  start: string
  end: string
  lokalizacjaId?: string | null
}

export interface DayGroup {
  /** ISO date, YYYY-MM-DD. */
  date: string
  /** Polish weekday, capitalised: "Poniedziałek". */
  weekday: string
  /** Day and month for the header: "12 marca". */
  dayLabel: string
  isToday: boolean
  shifts: WeekShift[]
}

const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota']
const MONTHS_GENITIVE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
]

/** Parse YYYY-MM-DD as a UTC calendar date — never as local time, which shifts the day near midnight. */
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1))
}

/** ISO date `n` days after `iso`. */
export function addDays(iso: string, n: number): string {
  const d = parseIso(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The seven days of `today`'s week, Monday first.
 *
 * Monday-first because Poland reads a week that way and the solver's horizon is also Monday-anchored
 * (SolveGrafikDto rejects a weekStart that is not a Monday), so the employee's week and the roster's
 * week are the same seven days.
 */
export function weekDays(today: string): string[] {
  const d = parseIso(today)
  const mondayOffset = (d.getUTCDay() + 6) % 7
  const monday = addDays(today, -mondayOffset)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Human label for a day header: "Poniedziałek, 12 marca". */
export function dayLabel(iso: string): { weekday: string; dayLabel: string } {
  const d = parseIso(iso)
  return {
    weekday: WEEKDAYS[d.getUTCDay()]!,
    dayLabel: `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()]!}`,
  }
}

/**
 * Group the week's shifts by day, keeping EMPTY days.
 *
 * An empty day is information — "I am not working Thursday" is exactly as useful as knowing the
 * Wednesday start time, and dropping it would make the list read as a dense block of work with no
 * shape. Shifts inside a day are ordered by start time.
 */
export function groupByDay(shifts: WeekShift[], today: string): DayGroup[] {
  const days = weekDays(today)
  const byDate = new Map<string, WeekShift[]>()
  for (const s of shifts) {
    // /api/grafik/shifts returns `date` as a full ISO datetime ("2026-08-11T00:00:00.000Z"), not a
    // bare YYYY-MM-DD — comparing it straight against `days` never matched, so every shift silently
    // vanished from this view (found live 2026-08-10, no test caught it because the fixtures above
    // already use bare dates).
    const day = s.date.slice(0, 10)
    if (!days.includes(day)) continue
    const list = byDate.get(day) ?? []
    list.push(s)
    byDate.set(day, list)
  }

  return days.map((date) => ({
    date,
    ...dayLabel(date),
    isToday: date === today,
    shifts: (byDate.get(date) ?? []).slice().sort((a, b) => a.start.localeCompare(b.start)),
  }))
}

/** Today as YYYY-MM-DD in local time — the employee's "today", not UTC's. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
