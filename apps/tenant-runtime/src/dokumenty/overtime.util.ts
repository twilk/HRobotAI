/**
 * `dokumenty` overtime engine — PURE functions only (no Prisma/I/O). Norms come from `cfg`
 * (SPEC §3.3), never hardcoded. SPEC §3.2 / acceptance DOK-4, DOK-5.
 *
 * Load-bearing rules:
 *  - DOK-4 NO DOUBLE-COUNT: weekly-average overtime (100%) subtracts minutes already counted as
 *    daily overtime (50%), so the same minute is never billed as both. {@link overtimeWeekly}.
 *  - DOK-5: night (22:00–06:00), Sunday and holiday work carries a 100% premium
 *    ({@link overtimeNightSundayHoliday}), driven entirely by the explicit demo `cfg`.
 *  - NULL-POLICY: days with `workedMinutes === null` (no RCP reading) are EXCLUDED from the
 *    overtime base — never punished as 0 nor rewarded. The summary reports "dni bez danych RCP: N".
 *  - Annual overtime limit (150h) is a WARNING ONLY — the engine never blocks (art. 22 RODO).
 *
 * These premiums are DEMO / POGLĄDOWE (art. 151¹ KP) — see `dokumenty.config.ts`.
 */

import { warsawParts, periodDayKeys, type EwidencjaRow, type WorkSession, type Period } from './rcp.util.js'
import type { DokumentyConfig } from './dokumenty.config.js'

// =================================================================================================
// overtimeDaily
// =================================================================================================

export type DailyOvertime = {
  /** Minutes counted at the normal rate (capped at the daily norm). */
  normalMin: number
  /** Minutes over the daily norm — the 50% premium base. */
  ot50Min: number
}

/**
 * Split a day's worked minutes into normal vs. 50%-premium overtime relative to the daily norm.
 * `normaDobowaMin` is supplied by the caller from `cfg` — never hardcoded.
 */
export function overtimeDaily(workedMinutes: number, normaDobowaMin: number): DailyOvertime {
  const ot50Min = Math.max(0, workedMinutes - normaDobowaMin)
  return { normalMin: workedMinutes - ot50Min, ot50Min }
}

// =================================================================================================
// overtimeWeekly
// =================================================================================================

/** Numeric worked minutes of the period, excluding `null` (no-RCP) days. */
function totalWorked(rows: EwidencjaRow[]): number {
  return rows.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0)
}

/** Total daily (50%) overtime across the period, excluding `null` days. */
function totalDailyOt(rows: EwidencjaRow[], normaDobowaMin: number): number {
  return rows.reduce((sum, r) => (r.workedMinutes === null ? sum : sum + overtimeDaily(r.workedMinutes, normaDobowaMin).ot50Min), 0)
}

export type WeeklyOvertime = { ot100Min: number }

/**
 * Average-weekly overtime (100% premium), settled at the END of the settlement period. Computed as
 *
 *   ot100 = max(0, totalWorked − totalDailyOt − normaTygodnMin × weeks)
 *
 * The `− totalDailyOt` term is the DOK-4 guardrail: minutes already billed as daily overtime are
 * removed from the weekly base, so they are never double-counted. `weeks` is `daysInPeriod / 7`
 * (demo approximation of the nominal working-time dimension — 🔴 DECYZJA-4M for the real basis).
 * Null (no-RCP) days contribute nothing to the base. `normaDobowaMin` (default `normaTygodnMin/5`,
 * i.e. 8h for a 40h week) is the daily norm used to compute the excluded daily overtime.
 */
export function overtimeWeekly(
  rows: EwidencjaRow[],
  normaTygodnMin: number,
  period: Period,
  normaDobowaMin: number = normaTygodnMin / 5,
): WeeklyOvertime {
  const weeks = periodDayKeys(period).length / 7
  const baseline = normaTygodnMin * weeks
  const ot100Min = Math.max(0, totalWorked(rows) - totalDailyOt(rows, normaDobowaMin) - baseline)
  return { ot100Min }
}

// =================================================================================================
// overtimeNightSundayHoliday
// =================================================================================================

export type NightSundayHolidayOvertime = {
  /** Minutes worked inside the night window (22:00–06:00 local). */
  nightMin: number
  /** Minutes worked on Sundays. */
  sundayMin: number
  /** Minutes worked on holidays (cfg table). */
  holidayMin: number
  /** Union 100%-premium minutes: whole session on Sunday/holiday, else the night portion. */
  ot100Min: number
}

/** Count minutes of `[start, end)` (UTC) that fall in the local night window. Minute-stepped. */
function nightMinutesOf(start: Date, end: Date, cfg: DokumentyConfig): number {
  const { startHour, endHour } = cfg.poraNocna // e.g. 22..6 (wraps midnight)
  const isNightHour = (h: number) => (startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour)
  let count = 0
  const stepMs = 60_000
  // Sample the midpoint of each minute to avoid boundary ambiguity.
  for (let t = start.getTime() + stepMs / 2; t < end.getTime(); t += stepMs) {
    if (isNightHour(warsawParts(new Date(t)).hour)) count++
  }
  return count
}

/**
 * Night / Sunday / holiday 100% premium across sessions (DOK-5). Sunday and holiday are keyed to the
 * session's local START day. `ot100Min` is a UNION (counted once): a Sunday/holiday session
 * contributes its whole worked span, otherwise it contributes only its night portion — so night ⊂
 * Sunday/holiday is not billed twice. `null`/unpaired sessions are skipped. Breaks are not carved
 * out of the night window (documented demo approximation).
 */
export function overtimeNightSundayHoliday(sessions: WorkSession[], cfg: DokumentyConfig): NightSundayHolidayOvertime {
  let nightMin = 0
  let sundayMin = 0
  let holidayMin = 0
  let ot100Min = 0
  const holidays = new Set(cfg.swietaPl)

  for (const s of sessions) {
    if (s.workedMinutes === null || s.start === null || s.end === null) continue
    const parts = warsawParts(s.start)
    const isSunday = parts.dayOfWeek === 0
    const isHoliday = holidays.has(parts.dateKey)
    const nm = nightMinutesOf(s.start, s.end, cfg)

    nightMin += nm
    if (isSunday) sundayMin += s.workedMinutes
    if (isHoliday) holidayMin += s.workedMinutes
    ot100Min += isSunday || isHoliday ? s.workedMinutes : nm
  }

  return { nightMin, sundayMin, holidayMin, ot100Min }
}

// =================================================================================================
// overtimeSummary
// =================================================================================================

export type AnnualLimitWarning = {
  /** Configured annual limit (minutes). */
  limitMin: number
  /** Prior-year-to-date OT + this period's OT (minutes). */
  projectedMin: number
}

export type OvertimeSummary = {
  /** Daily 50% overtime total. */
  ot50Min: number
  /** Average-weekly 100% overtime total (double-count-safe). */
  ot100Min: number
  /** Night 100% minutes (informational breakdown). */
  nightMin: number
  /** Sunday 100% minutes (informational breakdown). */
  sundayMin: number
  /** Holiday 100% minutes (informational breakdown). */
  holidayMin: number
  /** Union night/Sunday/holiday 100% minutes (counted once). */
  ot100NightSundayHolidayMin: number
  /** Number of days that produced any daily overtime. */
  count: number
  /** Number of days with a scheduled shift but no RCP reading (BRAK_RCP). */
  daysWithoutRcp: number
  /** Present only when prior-YTD + this period's OT exceeds the annual limit. WARNING, never a block. */
  annualLimitWarning?: AnnualLimitWarning
}

/**
 * Aggregate overtime for a period. Combines daily 50% (from `rows`), weekly-average 100% (from
 * `rows`) and night/Sunday/holiday 100% (from `sessions`). `priorAnnualOtMin` is the employee's
 * year-to-date overtime BEFORE this period; when `prior + ot50 + ot100` crosses
 * `cfg.limitRocznyNadgodzinMin` a WARNING is attached — the engine never blocks (art. 22 RODO).
 * Null (no-RCP) days are excluded from every base and surfaced via `daysWithoutRcp`.
 */
export function overtimeSummary(
  period: Period,
  rows: EwidencjaRow[],
  sessions: WorkSession[],
  cfg: DokumentyConfig,
  priorAnnualOtMin = 0,
): OvertimeSummary {
  const numericRows = rows.filter((r) => r.workedMinutes !== null)

  const ot50Min = numericRows.reduce((sum, r) => sum + overtimeDaily(r.workedMinutes as number, cfg.normaDobowaMin).ot50Min, 0)
  const ot100Min = overtimeWeekly(rows, cfg.normaTygodnMin, period, cfg.normaDobowaMin).ot100Min
  const nsh = overtimeNightSundayHoliday(sessions, cfg)

  const count = numericRows.filter((r) => overtimeDaily(r.workedMinutes as number, cfg.normaDobowaMin).ot50Min > 0).length
  const daysWithoutRcp = rows.filter((r) => r.workedMinutes === null && r.anomalie.includes('BRAK_RCP')).length

  const projectedMin = priorAnnualOtMin + ot50Min + ot100Min
  const annualLimitWarning =
    projectedMin > cfg.limitRocznyNadgodzinMin ? { limitMin: cfg.limitRocznyNadgodzinMin, projectedMin } : undefined

  return {
    ot50Min,
    ot100Min,
    nightMin: nsh.nightMin,
    sundayMin: nsh.sundayMin,
    holidayMin: nsh.holidayMin,
    ot100NightSundayHolidayMin: nsh.ot100Min,
    count,
    daysWithoutRcp,
    ...(annualLimitWarning ? { annualLimitWarning } : {}),
  }
}
