/**
 * PURE anomaly detection for the Analityk HR module (M3). Given the headline KPIs of the current
 * window and the immediately preceding one of equal length, it flags the shifts a human should look
 * at — an absence spike, an overtime surge, a growing approval backlog, decisions slowing down, or
 * headcount dropping.
 *
 * Deliberately DB-free and side-effect free so every rule can be unit-tested against hand-picked
 * numbers. No thresholds are hidden in the detector: each one is an exported constant, and every
 * finding carries the two values it was derived from so the UI can show its reasoning rather than an
 * unexplained warning badge.
 *
 * TWO GUARD RAILS the rules all share:
 *  - An UNKNOWN value on either side (a `null` KPI — see `ratio`/`median` in analityk.range.ts) never
 *    produces a finding. An unknown is not a change.
 *  - Every rule requires BOTH a relative jump AND an absolute one, so a move from 1 to 2 pending
 *    requests (+100%!) is not reported as a bottleneck while the tenant is small.
 */

import type { PorownanieKpi } from './analityk.service.js'
import { round } from './analityk.range.js'

/** How loudly a finding should be presented. There is no "critical" — this module only observes. */
export type WagaAnomalii = 'wysoka' | 'srednia'

/** Stable machine code per rule, so a UI can key off it without parsing Polish copy. */
export type KodAnomalii =
  | 'ABSENCJA_SKOK'
  | 'NADGODZINY_SKOK'
  | 'KOLEJKA_WNIOSKOW'
  | 'CZAS_DECYZJI'
  | 'SPADEK_ZATRUDNIENIA'

export interface Anomalia {
  kod: KodAnomalii
  waga: WagaAnomalii
  /** Short Polish headline for the finding. */
  tytul: string
  /** One sentence naming the two figures compared, so the reader can verify the claim. */
  opis: string
  wartoscBiezaca: number
  wartoscPoprzednia: number
  /** Absolute change (current − previous). */
  zmiana: number
  /** Relative change as a 0..1 fraction of the previous value; `null` when the previous value was 0. */
  zmianaWzgledna: number | null
}

// --- thresholds -----------------------------------------------------------------------------------

/** Absence: percentage-point rise that makes a spike worth reporting at all. */
export const PROG_ABSENCJA_PP = 0.015
/** Absence: percentage-point rise treated as a high-severity spike. */
export const PROG_ABSENCJA_PP_WYSOKA = 0.03
/** Absence: minimum relative rise, so a jump from 0.1% to 1.6% is not dressed up as a crisis. */
export const PROG_ABSENCJA_WZGL = 0.5

/** Overtime: minimum relative rise and the absolute hours that must accompany it. */
export const PROG_NADGODZINY_WZGL = 0.25
export const PROG_NADGODZINY_H = 20

/** Approval backlog: minimum relative growth and the absolute request count accompanying it. */
export const PROG_KOLEJKA_WZGL = 0.5
export const PROG_KOLEJKA_SZT = 5

/** Time-to-decision: minimum relative and absolute (hours) degradation. */
export const PROG_DECYZJA_WZGL = 0.5
export const PROG_DECYZJA_H = 12

/** Headcount: minimum relative and absolute drop. */
export const PROG_ZATRUDNIENIE_WZGL = 0.05
export const PROG_ZATRUDNIENIE_OS = 2

// --- helpers --------------------------------------------------------------------------------------

/** Relative change vs `previous`; `null` when the baseline is 0 (no meaningful percentage exists). */
function relative(current: number, previous: number): number | null {
  if (previous === 0) return null
  return round((current - previous) / Math.abs(previous), 4)
}

/** `true` when the relative change is unknown (zero baseline) or at least `threshold`. */
function relativeAtLeast(current: number, previous: number, threshold: number): boolean {
  const rel = relative(current, previous)
  // A zero baseline cannot yield a percentage, so the absolute test alone decides.
  return rel === null ? true : rel >= threshold
}

/** Both sides must be real numbers — an unknown KPI is never an anomaly. */
function known(a: number | null | undefined, b: number | null | undefined): a is number {
  return typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)
}

function pp(value: number): string {
  return `${round(value * 100, 1)} p.p.`
}

// --- detector -------------------------------------------------------------------------------------

/**
 * Compare two equal-length windows and return every rule that fired, most severe first. An empty
 * array is the healthy answer — "nothing stands out" — never a fabricated all-clear finding.
 */
export function wykryjAnomalie(biezacy: PorownanieKpi, poprzedni: PorownanieKpi): Anomalia[] {
  const found: Anomalia[] = []

  const push = (a: Anomalia) => found.push(a)

  // 1. Absence spike — the single most actionable early warning in the set.
  if (known(biezacy.wskaznikAbsencji, poprzedni.wskaznikAbsencji)) {
    const current = biezacy.wskaznikAbsencji
    const previous = poprzedni.wskaznikAbsencji as number
    const delta = current - previous
    if (delta >= PROG_ABSENCJA_PP && relativeAtLeast(current, previous, PROG_ABSENCJA_WZGL)) {
      push({
        kod: 'ABSENCJA_SKOK',
        waga: delta >= PROG_ABSENCJA_PP_WYSOKA ? 'wysoka' : 'srednia',
        tytul: 'Skok absencji',
        opis: `Wskaźnik absencji wzrósł o ${pp(delta)} — z ${pp(previous)} do ${pp(current)} wobec poprzedniego okresu.`,
        wartoscBiezaca: current,
        wartoscPoprzednia: previous,
        zmiana: round(delta, 4),
        zmianaWzgledna: relative(current, previous),
      })
    }
  }

  // 2. Overtime surge — a cost and a working-time-compliance signal at once.
  {
    const current = biezacy.nadgodziny
    const previous = poprzedni.nadgodziny
    const delta = current - previous
    if (delta >= PROG_NADGODZINY_H && relativeAtLeast(current, previous, PROG_NADGODZINY_WZGL)) {
      push({
        kod: 'NADGODZINY_SKOK',
        waga: 'srednia',
        tytul: 'Wzrost nadgodzin',
        opis: `Nadgodziny wzrosły o ${round(delta, 1)} h — z ${round(previous, 1)} h do ${round(current, 1)} h.`,
        wartoscBiezaca: round(current, 1),
        wartoscPoprzednia: round(previous, 1),
        zmiana: round(delta, 1),
        zmianaWzgledna: relative(current, previous),
      })
    }
  }

  // 3. Approval backlog growth — requests are arriving faster than they are being decided.
  {
    const current = biezacy.wnioskiWToku
    const previous = poprzedni.wnioskiWToku
    const delta = current - previous
    if (delta >= PROG_KOLEJKA_SZT && relativeAtLeast(current, previous, PROG_KOLEJKA_WZGL)) {
      push({
        kod: 'KOLEJKA_WNIOSKOW',
        waga: 'srednia',
        tytul: 'Rosnąca kolejka wniosków',
        opis: `Liczba wniosków w toku wzrosła o ${delta} — z ${previous} do ${current}.`,
        wartoscBiezaca: current,
        wartoscPoprzednia: previous,
        zmiana: delta,
        zmianaWzgledna: relative(current, previous),
      })
    }
  }

  // 4. Decisions slowing down — the queue may look stable while each request waits far longer.
  if (known(biezacy.medianaGodzinDoDecyzji, poprzedni.medianaGodzinDoDecyzji)) {
    const current = biezacy.medianaGodzinDoDecyzji
    const previous = poprzedni.medianaGodzinDoDecyzji as number
    const delta = current - previous
    if (delta >= PROG_DECYZJA_H && relativeAtLeast(current, previous, PROG_DECYZJA_WZGL)) {
      push({
        kod: 'CZAS_DECYZJI',
        waga: 'srednia',
        tytul: 'Wydłużony czas decyzji',
        opis: `Mediana czasu do decyzji wydłużyła się o ${round(delta, 1)} h — z ${round(previous, 1)} h do ${round(current, 1)} h.`,
        wartoscBiezaca: round(current, 1),
        wartoscPoprzednia: round(previous, 1),
        zmiana: round(delta, 1),
        zmianaWzgledna: relative(current, previous),
      })
    }
  }

  // 5. Headcount drop — reported as a high-severity finding because it compounds every other metric.
  {
    const current = biezacy.stanZatrudnienia
    const previous = poprzedni.stanZatrudnienia
    const delta = current - previous
    const drop = -delta
    // NOTE: this is the only rule measuring a FALL, so it compares the drop against the baseline
    // directly — `relativeAtLeast` expects two levels, not a level and a delta.
    const dropWzgledny = previous === 0 ? null : drop / previous
    if (drop >= PROG_ZATRUDNIENIE_OS && (dropWzgledny === null || dropWzgledny >= PROG_ZATRUDNIENIE_WZGL)) {
      push({
        kod: 'SPADEK_ZATRUDNIENIA',
        waga: 'wysoka',
        tytul: 'Spadek zatrudnienia',
        opis: `Stan zatrudnienia spadł o ${drop} os. — z ${previous} do ${current}.`,
        wartoscBiezaca: current,
        wartoscPoprzednia: previous,
        zmiana: delta,
        zmianaWzgledna: relative(current, previous),
      })
    }
  }

  // Most severe first; within a severity, keep the declaration order above (a stable, meaningful
  // reading order rather than an arbitrary one).
  const rank: Record<WagaAnomalii, number> = { wysoka: 0, srednia: 1 }
  return found.sort((a, b) => rank[a.waga] - rank[b.waga])
}
