/**
 * Shared week/date helpers for the AI-grafik module (Codex P2-3). Extracted from
 * `replacement.service.ts` so {@link CostService} (SP4) can reuse the exact same ISO-week and
 * overnight-window semantics without duplicating them or depending on a private function.
 */

/** Minutes-since-midnight for an "HH:mm" clock time. */
export function toMinutes(clock: string): number {
  const [h, m] = clock.split(':')
  return Number(h) * 60 + Number(m)
}

/**
 * Minutes between two "HH:mm" clock times, wrapping past midnight for an overnight window
 * (`end < start` adds 24h). `end === start` yields exactly `0` — treated as an invalid/zero-length
 * window by callers, NEVER as a full 24h shift.
 */
export function windowMinutes(start: string, end: string): number {
  let mins = toMinutes(end) - toMinutes(start)
  if (mins < 0) mins += 24 * 60
  return mins
}

/**
 * The [Monday 00:00, next-Monday 00:00) UTC half-open range of the ISO week containing `date`.
 * `Shift.date` is a `@db.Date` stored at UTC midnight, so the whole computation stays in UTC.
 */
export function isoWeekRange(date: Date): { weekStart: Date; weekEndExcl: Date } {
  const day = date.getUTCDay() // 0=Sun .. 6=Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day
  const weekStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetToMonday),
  )
  const weekEndExcl = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { weekStart, weekEndExcl }
}
