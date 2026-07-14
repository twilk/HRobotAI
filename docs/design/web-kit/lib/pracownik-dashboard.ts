// Pure helpers for the PRACOWNIK "safe signals" dashboard board
// (components/dashboard/pracownik-board.tsx). Split out from the component so the date/hours/leave
// logic can be unit-tested without a DOM/render harness — this repo's vitest config only runs
// `lib/**/*.test.ts` under a `node` environment (no jsdom / @testing-library/react installed), see
// vitest.config.ts.
//
// RODO / GDPR Art. 22: this module deliberately carries NO performance/trajectory scoring — only
// factual self-service signals (my shifts, my hours vs. my own etat, my leave counts). See
// docs/superpowers/specs/2026-07-14-role-dashboards-component-audit.md §B1/§E-5.

/** Same short-weekday convention as lib/ai-grafik.ts's WEEKDAY_SHORT_PL (indexed by getUTCDay()). */
const WEEKDAY_SHORT_PL = ['nd', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'] as const

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * Duration of a shift in hours from its `HH:mm` start/end. An overnight shift (end < start, e.g.
 * "22:00"–"06:00") adds 24h before dividing; `start === end` is exactly 0 (not a 24h shift).
 */
export function shiftHours(start: string, end: string): number {
  if (start === end) return 0
  let mins = hhmmToMinutes(end) - hhmmToMinutes(start)
  if (mins < 0) mins += 24 * 60
  return mins / 60
}

/** Normalise an API date (`2026-07-06` or `2026-07-06T00:00:00.000Z`) to `YYYY-MM-DD`. */
function normalizeDate(value: string): string {
  return value.slice(0, 10)
}

/** Monday 00:00 UTC of the ISO week containing `date`. */
function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun … 6=Sat
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return d
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Mon..Sun (YYYY-MM-DD, UTC) span of the ISO week containing `iso`. */
export function weekRange(iso: string): { from: string; to: string } {
  const date = new Date(`${normalizeDate(iso)}T00:00:00.000Z`)
  const monday = mondayOf(date)
  return { from: isoDate(monday), to: isoDate(addDays(monday, 6)) }
}

/**
 * The next up-to-`limit` shifts on or after `todayIso`, sorted by date then start time. Generic over
 * any shift-like row so the component can pass its real API row shape without a cast.
 */
export function upcomingShifts<T extends { date: string; start: string }>(
  shifts: T[],
  todayIso: string,
  limit = 5,
): T[] {
  return shifts
    .filter((s) => normalizeDate(s.date) >= todayIso)
    .sort((a, b) => {
      const dateA = normalizeDate(a.date)
      const dateB = normalizeDate(b.date)
      if (dateA !== dateB) return dateA < dateB ? -1 : 1
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0
    })
    .slice(0, limit)
}

/** Sum of `shiftHours` for every shift whose date falls within `[fromIso, toIso]` inclusive. */
export function hoursInRange(
  shifts: { date: string; start: string; end: string }[],
  fromIso: string,
  toIso: string,
): number {
  return shifts.reduce((sum, s) => {
    const d = normalizeDate(s.date)
    if (d < fromIso || d > toIso) return sum
    return sum + shiftHours(s.start, s.end)
  }, 0)
}

/** Weekly target hours from an etat fraction (full-time ≈ 40h). Guards a non-numeric etat to 0. */
export function weeklyTargetHours(etat: string | number): number {
  const n = typeof etat === 'number' ? etat : parseFloat(etat)
  if (!Number.isFinite(n)) return 0
  return n * 40
}

export interface LeaveSummaryCounts {
  approved: number
  pending: number
  rejected: number
}

/** Counts of the caller's own leave requests by status (APPROVED / PENDING / REJECTED only). */
export function leaveSummary(leaves: { status: string }[]): LeaveSummaryCounts {
  const counts: LeaveSummaryCounts = { approved: 0, pending: 0, rejected: 0 }
  for (const l of leaves) {
    if (l.status === 'APPROVED') counts.approved += 1
    else if (l.status === 'PENDING') counts.pending += 1
    else if (l.status === 'REJECTED') counts.rejected += 1
  }
  return counts
}

/** "pon 04.10" style short label for a shift row's date (Polish weekday short + dd.mm, UTC). */
export function fmtShiftDay(iso: string): string {
  const norm = normalizeDate(iso)
  const d = new Date(`${norm}T00:00:00.000Z`)
  const wd = WEEKDAY_SHORT_PL[d.getUTCDay()]
  const dd = norm.slice(8, 10)
  const mm = norm.slice(5, 7)
  return `${wd} ${dd}.${mm}`
}
