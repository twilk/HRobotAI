// Pure helpers for the MANAGER "operational" dashboard board (components/dashboard/manager-board.tsx).
// Split out from the component so the date/aggregation logic can be unit-tested without a DOM/render
// harness — this repo's vitest config only runs `lib/**/*.test.ts` under a `node` environment (no
// jsdom / @testing-library/react installed), see vitest.config.ts.
//
// Mirrors lib/pracownik-dashboard.ts's UTC-date convention (YYYY-MM-DD, Monday-first ISO week) so the
// manager board's "this week" / "next 14 days" windows line up with the employee board's.

/** Monday 00:00 UTC of the ISO week containing `date`. */
function mondayOfDate(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun … 6=Sat
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Normalise an API date (`2026-07-06` or `2026-07-06T00:00:00.000Z`) to `YYYY-MM-DD`. */
function normalizeDate(value: string): string {
  return value.slice(0, 10)
}

/** Monday (`YYYY-MM-DD`, UTC) of the ISO week containing `iso`. Used as `weekStart` for /api/koszty/week. */
export function mondayOf(iso: string): string {
  const date = new Date(`${normalizeDate(iso)}T00:00:00.000Z`)
  return isoDate(mondayOfDate(date))
}

/** `iso` shifted by `n` days (UTC, may be negative), as `YYYY-MM-DD`. Used to build the 14-day scan window. */
export function addDaysIso(iso: string, n: number): string {
  const date = new Date(`${normalizeDate(iso)}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return isoDate(date)
}

/** Counts feeding the "Skrzynka decyzji" section's total + per-row badges. */
export interface DecisionCounts {
  wnioski: number
  swaps: number
  proposals: number
}

/** Sum of every decision-queue count — the section header's "N do zrobienia". */
export function decisionTotal(counts: DecisionCounts): number {
  return counts.wnioski + counts.swaps + counts.proposals
}

/** One row in the "Skrzynka decyzji" list — a queue with its live count and a link to the full screen. */
export interface DecisionItem {
  key: string
  label: string
  count: number
  href: string
}

/**
 * Stable-sort `items` so non-zero counts surface first (highest count first among those), ties/zeros
 * keep their original relative order. Pure so the "what needs my attention now" ordering is
 * unit-testable independent of the fetch that produces the counts.
 */
export function sortDecisions(items: DecisionItem[]): DecisionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aZero = a.item.count === 0
      const bZero = b.item.count === 0
      if (aZero !== bZero) return aZero ? 1 : -1
      if (a.item.count !== b.item.count) return b.item.count - a.item.count
      return a.index - b.index
    })
    .map(({ item }) => item)
}
