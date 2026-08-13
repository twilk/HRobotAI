/**
 * PURE date + statistics helpers for the Analityk HR module (M3). Everything here is deliberately
 * side-effect free and DB-free so the aggregation arithmetic can be unit-tested against hand-computed
 * expectations without a database.
 *
 * All dates are handled in **UTC**. `Shift.date`, `LeaveRequest.startDate` and `LeaveRequest.endDate`
 * are Prisma `@db.Date` columns stored at UTC midnight, so staying in UTC end-to-end avoids the
 * off-by-one-day drift a local-timezone conversion would introduce for `Europe/Warsaw` callers.
 */

import { BadRequestException } from '@nestjs/common'

/** A closed, inclusive analysis range plus its exclusive upper bound (for Prisma `lt` filters). */
export interface AnalitykRange {
  /** Inclusive lower bound at UTC midnight. */
  from: Date
  /** Inclusive upper bound at UTC midnight. */
  toIncl: Date
  /** Exclusive upper bound (`toIncl` + 1 day) — use with Prisma `lt`. */
  toExcl: Date
}

const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parse a strict `YYYY-MM-DD` string into a UTC-midnight `Date`. Anything else is a 400. */
export function parseIsoDate(value: string, field: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new BadRequestException(`Parametr "${field}" musi mieć format YYYY-MM-DD`)
  }
  const parts = value.split('-').map(Number)
  const y = parts[0] as number
  const m = parts[1] as number
  const d = parts[2] as number
  const parsed = new Date(Date.UTC(y, m - 1, d))
  // Rejects impossible calendar dates that still match the regex (e.g. 2026-02-30 → 2026-03-02).
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    throw new BadRequestException(`Parametr "${field}" nie jest poprawną datą`)
  }
  return parsed
}

/**
 * Build the analysis range from the `od`/`do` query params. Both are required by the controller's
 * DTO; an inverted range (`do` < `od`) is a 400 rather than a silently empty report.
 */
export function buildRange(od: string, doDate: string): AnalitykRange {
  const from = parseIsoDate(od, 'od')
  const toIncl = parseIsoDate(doDate, 'do')
  if (toIncl.getTime() < from.getTime()) {
    throw new BadRequestException('Parametr "do" nie może być wcześniejszy niż "od"')
  }
  return { from, toIncl, toExcl: addDays(toIncl, 1) }
}

/** `date` + `n` days, in UTC. */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS)
}

/**
 * The UTC-midnight instant of the calendar day `date` falls in. `Employee.hiredAt` and
 * `AuditLog.createdAt` are full timestamps, unlike the `@db.Date` columns; normalizing them before
 * any day-counting keeps a 09:00 hire and a midnight one worth the same number of working days.
 */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** `YYYY-MM-DD` key for a UTC date (grouping / display). */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** `YYYY-MM` key for a UTC date (monthly buckets). */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

/**
 * Monday-anchored ISO-week key (`YYYY-MM-DD` of that week's Monday). Uses the SAME Monday-anchoring
 * as `ai-grafik/week-range.util.ts#isoWeekRange`, so a working-time week here and a cost week there
 * always describe the identical 7-day window.
 */
export function weekKey(date: Date): string {
  const day = date.getUTCDay() // 0=Sun .. 6=Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day
  return dayKey(addDays(date, offsetToMonday))
}

/**
 * Mon–Fri. NOTE: the tenant schema carries no public-holiday calendar, so Polish statutory holidays
 * are NOT excluded from the working-day denominators. Every rate derived from `businessDaysBetween`
 * is therefore a slight UNDER-estimate in months containing holidays — documented rather than
 * silently approximated, and surfaced to the UI via `AnalitykMeta.uwagi`.
 */
export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay()
  return day !== 0 && day !== 6
}

/** Inclusive calendar-day count of `[fromIncl, toIncl]`; `0` when the range is inverted. */
export function daysInclusive(fromIncl: Date, toIncl: Date): number {
  const diff = Math.round((toIncl.getTime() - fromIncl.getTime()) / DAY_MS) + 1
  return diff > 0 ? diff : 0
}

/** Mon–Fri day count of `[fromIncl, toIncl]`; `0` when the range is inverted. */
export function businessDaysBetween(fromIncl: Date, toIncl: Date): number {
  let count = 0
  for (let d = fromIncl; d.getTime() <= toIncl.getTime(); d = addDays(d, 1)) {
    if (isBusinessDay(d)) count += 1
  }
  return count
}

/** The `[start, end]` overlap of two inclusive intervals, or `null` when they are disjoint. */
export function intersectInclusive(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): { start: Date; end: Date } | null {
  const start = aStart.getTime() > bStart.getTime() ? aStart : bStart
  const end = aEnd.getTime() < bEnd.getTime() ? aEnd : bEnd
  return start.getTime() <= end.getTime() ? { start, end } : null
}

/** Mon–Fri days an inclusive interval contributes inside `range`; `0` when it does not overlap. */
export function businessDaysInRange(start: Date, end: Date, range: { from: Date; toIncl: Date }): number {
  const overlap = intersectInclusive(start, end, range.from, range.toIncl)
  return overlap ? businessDaysBetween(overlap.start, overlap.end) : 0
}

/** Ascending `YYYY-MM` keys covering every month the range touches (always ≥ 1 entry). */
export function monthBuckets(range: { from: Date; toIncl: Date }): string[] {
  const keys: string[] = []
  let cursor = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1))
  const last = new Date(Date.UTC(range.toIncl.getUTCFullYear(), range.toIncl.getUTCMonth(), 1))
  while (cursor.getTime() <= last.getTime()) {
    keys.push(monthKey(cursor))
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  }
  return keys
}

/**
 * Median of a numeric sample — `null` for an empty sample (NEVER `0`, which would read as "decisions
 * are instant" rather than "no decisions were taken"). Even samples average the two middle values.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid] as number
  if (sorted.length % 2 === 1) return upper
  return ((sorted[mid - 1] as number) + upper) / 2
}

/** Round to `digits` decimals (default 2) — keeps JSON payloads free of float noise. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * `numerator / denominator` guarded against a zero denominator, which yields `null` rather than `0`
 * or `NaN`: "no working days in scope" is an UNKNOWN rate, not a 0% rate.
 */
export function ratio(numerator: number, denominator: number, digits = 4): number | null {
  if (denominator <= 0) return null
  return round(numerator / denominator, digits)
}
