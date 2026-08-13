/**
 * `dokumenty` RCP engine — PURE functions only. No Prisma, no I/O, no EncryptionService. Input is
 * plain objects (`*Lite`), output is numbers/structures. Mirrors `strategic-brain/scoring.util.ts`.
 *
 * Two load-bearing concerns (SPEC §3.1):
 *
 *  1. NULL-POLICY (DOK-3). "Brak danych" is NEVER silently read as 0:
 *     - a day with a scheduled `Shift` but no RCP events → `workedMinutes = null` + `BRAK_RCP`
 *       (NOT 0h — "we have no reading" ≠ "they worked zero"), exactly like scoring.util's M7.
 *     - an unpaired event (WEJSCIE without WYJSCIE, or the reverse) → `NIESPAROWANE`, minutes `null`
 *       (we do NOT invent a clock-out at midnight — SPEC §3.1 leaves the close-rule to 4Mobility).
 *     - RCP events landing on an approved-leave day → `RCP_W_NIEOBECNOSCI` (kadry decide).
 *     Absences are classified STRUCTURALLY via {@link leaveCategoryOf} (a documented type→category
 *     map), never by ad-hoc string matching — the strategic-brain M12 discipline.
 *
 *  2. TIMEZONE. Events are UTC instants; aggregation happens on the Europe/Warsaw calendar. The
 *     Warsaw offset is derived EXPLICITLY from the EU DST rule (no tz library) — see
 *     {@link warsawOffsetMinutes}. Mapping a UTC instant → local wall-clock is unambiguous, so DST
 *     "spring-forward"/"fall-back" days are handled correctly for day-assignment; worked-minute
 *     durations are computed from the UTC instants and are therefore invariant to the clock jump.
 */

import { leaveCategoryOf, type DokumentyConfig, type LeaveCategory } from './dokumenty.config.js'

// =================================================================================================
// Input/output types (Prisma-free projections)
// =================================================================================================

export type RcpEventType = 'WEJSCIE' | 'WYJSCIE' | 'PRZERWA_START' | 'PRZERWA_KONIEC'

/** Minimal RCP event projection the engine needs. `occurredAt` is a UTC instant. */
export type RcpEventLite = {
  employeeId: string
  occurredAt: Date
  type: RcpEventType
}

/** A scheduled shift day (date-only). Used solely to know "was work EXPECTED this day" (BRAK_RCP). */
export type ShiftLite = {
  employeeId: string
  /** Calendar date of the shift (its UTC Y-M-D is taken as the local calendar day). */
  date: Date
}

/** Approved/pending leave over a closed date interval. `type` is the free-form `LeaveRequest.type`. */
export type LeaveLite = {
  employeeId: string
  startDate: Date
  endDate: Date
  type: string
  /** LeaveStatus; only `APPROVED` counts as an actual absence (documented — SPEC §3.1). */
  status?: string
}

/** Reporting period as calendar dates (inclusive). Their UTC Y-M-D are the boundary day keys. */
export type Period = { start: Date; end: Date }

export type Anomalia =
  | 'BRAK_RCP'
  | 'NIESPAROWANE'
  | 'RCP_W_NIEOBECNOSCI'
  | 'PRZERWA_NIEZAKONCZONA'
  | 'PRZERWA_ZAGNIEZDZONA'
  | 'PRZERWA_NIESPAROWANA'

/** A paired (or intentionally unpaired) work session. `start`/`end` are UTC instants. */
export type WorkSession = {
  employeeId: string
  /** WEJSCIE instant; `null` for an orphan WYJSCIE. */
  start: Date | null
  /** WYJSCIE instant; `null` for an orphan WEJSCIE (session never closed). */
  end: Date | null
  breakMinutes: number
  /** `(end-start) - breaks`; `null` when the session is unpaired (cannot be determined). */
  workedMinutes: number | null
  anomalie: Anomalia[]
}

/** One calendar day of the ewidencja (time record). SPEC §3.1. */
export type EwidencjaRow = {
  /** Europe/Warsaw calendar day, `YYYY-MM-DD`. */
  date: string
  firstIn: Date | null
  lastOut: Date | null
  /** `null` = brak danych (BRAK_RCP / niesparowane / dzień bez grafiku); NEVER 0-for-missing. */
  workedMinutes: number | null
  breakMinutes: number
  /** Structural absence category when an approved leave overlaps the day. */
  absence?: LeaveCategory
  anomalie: Anomalia[]
}

// =================================================================================================
// Timezone (Europe/Warsaw) — explicit EU DST rule, no tz library
// =================================================================================================

const CET_OFFSET_MIN = 60 // UTC+1 (winter)
const CEST_OFFSET_MIN = 120 // UTC+2 (summer / DST)

/** UTC instant of the last Sunday of `month0` (0-based) in `year`, at `hourUtc:00`. */
function lastSundayUtc(year: number, month0: number, hourUtc: number): Date {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)) // day 0 of next month = last day of this
  const day = lastDay.getUTCDate() - lastDay.getUTCDay() // back up to the Sunday
  return new Date(Date.UTC(year, month0, day, hourUtc, 0, 0))
}

/**
 * Europe/Warsaw UTC-offset in minutes for a given UTC instant, per the EU DST rule: DST runs from
 * the last Sunday of March 01:00 UTC (clocks 02:00→03:00 local) to the last Sunday of October
 * 01:00 UTC (clocks 03:00→02:00 local). Returns 120 (CEST) inside that window, else 60 (CET).
 */
export function warsawOffsetMinutes(utc: Date): number {
  const year = utc.getUTCFullYear()
  const dstStart = lastSundayUtc(year, 2, 1) // March, 01:00 UTC
  const dstEnd = lastSundayUtc(year, 9, 1) // October, 01:00 UTC
  return utc >= dstStart && utc < dstEnd ? CEST_OFFSET_MIN : CET_OFFSET_MIN
}

export type WarsawParts = {
  /** `YYYY-MM-DD` local calendar day. */
  dateKey: string
  year: number
  /** 1-based month. */
  month: number
  day: number
  hour: number
  minute: number
  /** 0 = Sunday .. 6 = Saturday (local). */
  dayOfWeek: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Decompose a UTC instant into Europe/Warsaw wall-clock parts. */
export function warsawParts(utc: Date): WarsawParts {
  const shifted = new Date(utc.getTime() + warsawOffsetMinutes(utc) * 60_000)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  return {
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    year,
    month,
    day,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  }
}

/** `YYYY-MM-DD` key of a date's UTC calendar day (period/shift boundaries are stored date-only). */
function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000

// =================================================================================================
// pairEvents
// =================================================================================================

/**
 * Pair raw RCP events into work sessions per employee. Events are grouped by `employeeId`, sorted by
 * `occurredAt`, then a small state machine pairs WEJSCIE↔WYJSCIE and PRZERWA_START↔PRZERWA_KONIEC.
 * Break minutes are subtracted from the span. Unpaired opens/closes and unterminated/nested breaks
 * are flagged (see {@link Anomalia}) rather than guessed away.
 */
export function pairEvents(events: RcpEventLite[]): WorkSession[] {
  const byEmp = new Map<string, RcpEventLite[]>()
  for (const e of events) {
    const arr = byEmp.get(e.employeeId)
    if (arr) arr.push(e)
    else byEmp.set(e.employeeId, [e])
  }

  const sessions: WorkSession[] = []
  for (const [employeeId, evs] of byEmp) {
    const sorted = [...evs].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

    // Open-session accumulator.
    let start: Date | null = null
    let breakStart: Date | null = null
    let breakMinutes = 0
    let anomalie: Anomalia[] = []

    const closeUnpairedStart = () => {
      // A WEJSCIE that never saw its WYJSCIE.
      sessions.push({ employeeId, start, end: null, breakMinutes, workedMinutes: null, anomalie: [...anomalie, 'NIESPAROWANE'] })
    }
    const reset = () => {
      start = null
      breakStart = null
      breakMinutes = 0
      anomalie = []
    }

    for (const e of sorted) {
      switch (e.type) {
        case 'WEJSCIE': {
          if (start !== null) {
            // New entry while a session is still open → previous one is unpaired.
            closeUnpairedStart()
            reset()
          }
          start = e.occurredAt
          break
        }
        case 'WYJSCIE': {
          if (start === null) {
            // Orphan exit — no matching entry.
            sessions.push({ employeeId, start: null, end: e.occurredAt, breakMinutes: 0, workedMinutes: null, anomalie: ['NIESPAROWANE'] })
            break
          }
          if (breakStart !== null) {
            // Break never explicitly ended → close it at the WYJSCIE, flag it.
            breakMinutes += minutesBetween(breakStart, e.occurredAt)
            anomalie.push('PRZERWA_NIEZAKONCZONA')
            breakStart = null
          }
          const worked = minutesBetween(start, e.occurredAt) - breakMinutes
          sessions.push({ employeeId, start, end: e.occurredAt, breakMinutes, workedMinutes: worked, anomalie: [...anomalie] })
          reset()
          break
        }
        case 'PRZERWA_START': {
          if (breakStart !== null) {
            // Nested break start without an intervening end.
            anomalie.push('PRZERWA_ZAGNIEZDZONA')
            break // keep the first (earlier) break start
          }
          breakStart = e.occurredAt
          break
        }
        case 'PRZERWA_KONIEC': {
          if (breakStart === null) {
            anomalie.push('PRZERWA_NIESPAROWANA')
            break
          }
          breakMinutes += minutesBetween(breakStart, e.occurredAt)
          breakStart = null
          break
        }
      }
    }

    if (start !== null) closeUnpairedStart() // trailing open session at end of stream
  }

  return sessions
}

// =================================================================================================
// dailyWorkedMinutes
// =================================================================================================

/** Anchor day of a session in Warsaw local calendar (start if present, else end). */
function sessionDayKey(s: WorkSession): string | null {
  const anchor = s.start ?? s.end
  return anchor ? warsawParts(anchor).dateKey : null
}

/**
 * Sum of numeric worked minutes for sessions falling on the given local `day` (`YYYY-MM-DD`).
 * Unpaired (`workedMinutes === null`) sessions contribute nothing here — the caller
 * ({@link aggregateEwidencja}) is where the null-policy is expressed at the row level. Only
 * `Europe/Warsaw` is supported on demo.
 */
export function dailyWorkedMinutes(sessions: WorkSession[], day: string, tz = 'Europe/Warsaw'): number {
  if (tz !== 'Europe/Warsaw') throw new Error(`dokumenty demo supports only Europe/Warsaw, got ${tz}`)
  let sum = 0
  for (const s of sessions) {
    if (s.workedMinutes === null) continue
    if (sessionDayKey(s) === day) sum += s.workedMinutes
  }
  return sum
}

// =================================================================================================
// aggregateEwidencja
// =================================================================================================

/** Iterate calendar day-keys from `start` to `end` inclusive (UTC calendar of the boundaries). */
export function periodDayKeys(period: Period): string[] {
  const keys: string[] = []
  const cur = new Date(Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth(), period.start.getUTCDate()))
  const endKey = utcDateKey(period.end)
  // Guard against a reversed period.
  let guard = 0
  while (guard++ < 100_000) {
    keys.push(utcDateKey(cur))
    if (utcDateKey(cur) === endKey) break
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return keys
}

const dateKeyInInterval = (day: string, start: Date, end: Date) => day >= utcDateKey(start) && day <= utcDateKey(end)

/**
 * Per-day ewidencja for a SINGLE employee (caller pre-filters `events`/`leaves`/`shifts` to one
 * employee — sessions are grouped defensively regardless). Emits one {@link EwidencjaRow} per
 * calendar day of `period`, applying the DOK-3 null-policy. `cfg` supplies the leave-type→category
 * map; nothing is hardcoded.
 */
export function aggregateEwidencja(
  events: RcpEventLite[],
  leaves: LeaveLite[],
  shifts: ShiftLite[],
  period: Period,
  cfg: DokumentyConfig,
): EwidencjaRow[] {
  const sessions = pairEvents(events)

  // Index sessions and scheduled shifts by local/calendar day key.
  const sessionsByDay = new Map<string, WorkSession[]>()
  for (const s of sessions) {
    const key = sessionDayKey(s)
    if (!key) continue
    const arr = sessionsByDay.get(key)
    if (arr) arr.push(s)
    else sessionsByDay.set(key, [s])
  }
  const shiftDays = new Set<string>(shifts.map((s) => utcDateKey(s.date)))
  const approvedLeaves = leaves.filter((l) => (l.status ?? 'APPROVED') === 'APPROVED')

  const rows: EwidencjaRow[] = []
  for (const day of periodDayKeys(period)) {
    const daySessions = sessionsByDay.get(day) ?? []
    const anomalie: Anomalia[] = []

    const leave = approvedLeaves.find((l) => dateKeyInInterval(day, l.startDate, l.endDate))
    const absence: LeaveCategory | undefined = leave ? leaveCategoryOf(leave.type, cfg) : undefined

    const hasEvents = daySessions.length > 0

    // Collect any break-level anomalies bubbled up from the sessions.
    for (const s of daySessions) {
      for (const a of s.anomalie) if (a !== 'NIESPAROWANE' && !anomalie.includes(a)) anomalie.push(a)
    }

    let workedMinutes: number | null
    let breakMinutes = 0
    let firstIn: Date | null = null
    let lastOut: Date | null = null

    if (!hasEvents) {
      // No readings. null (never 0). BRAK_RCP only if work was scheduled AND it is not a leave day.
      workedMinutes = null
      if (!absence && shiftDays.has(day)) anomalie.push('BRAK_RCP')
    } else {
      const paired = daySessions.filter((s) => s.workedMinutes !== null)
      const hasUnpaired = daySessions.some((s) => s.workedMinutes === null)
      if (hasUnpaired) anomalie.push('NIESPAROWANE')

      // Worked minutes = sum of paired sessions; null if the ONLY session(s) were unpaired.
      workedMinutes = paired.length > 0 ? paired.reduce((sum, s) => sum + (s.workedMinutes as number), 0) : null
      breakMinutes = paired.reduce((sum, s) => sum + s.breakMinutes, 0)

      for (const s of daySessions) {
        if (s.start && (!firstIn || s.start < firstIn)) firstIn = s.start
        if (s.end && (!lastOut || s.end > lastOut)) lastOut = s.end
      }

      // Working during an absence — flag for kadry.
      if (absence) anomalie.push('RCP_W_NIEOBECNOSCI')
    }

    rows.push({ date: day, firstIn, lastOut, workedMinutes, breakMinutes, ...(absence ? { absence } : {}), anomalie })
  }

  return rows
}
