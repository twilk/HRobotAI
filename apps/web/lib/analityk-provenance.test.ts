import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROWIENIENCJA, opisOkna, opisProwieniencji } from './analityk-provenance'

const DASHBOARD = fileURLToPath(new URL('../components/analityk/dashboard.tsx', import.meta.url))

/** Every `label="…"` passed to a <KpiTile> in the dashboard. */
function kpiLabelsOnScreen(): string[] {
  const src = readFileSync(DASHBOARD, 'utf8')
  return [...src.matchAll(/<KpiTile\b[\s\S]*?label="([^"]+)"/g)].map((m) => m[1]!)
}

describe('[ARCHITECTURAL GUARD] every KPI states where it comes from', () => {
  it('finds the KPI tiles (not vacuous)', () => {
    // If the scrape breaks, the assertion below would pass over an empty list.
    expect(kpiLabelsOnScreen().length).toBeGreaterThanOrEqual(6)
  })

  it('every KPI rendered on the screen has a provenance entry', () => {
    // A new tile without an entry renders "brak opisu źródła" in red — this fails first, in CI.
    const missing = kpiLabelsOnScreen().filter((label) => !PROWIENIENCJA[label])
    expect(missing).toEqual([])
  })

  it('no provenance entry is stale (each one names a KPI still on screen)', () => {
    // Self-cleaning, same as the middleware matcher guard: a removed KPI must not leave a caveat
    // behind claiming to describe something the reader can no longer see.
    const onScreen = new Set(kpiLabelsOnScreen())
    const orphaned = Object.keys(PROWIENIENCJA).filter((label) => !onScreen.has(label))
    expect(orphaned).toEqual([])
  })
})

describe('provenance content', () => {
  it('marks planned figures as planned, not counted', () => {
    // The distinction the retired overtime metric got wrong: rostered time is not worked time.
    expect(PROWIENIENCJA['Suma godzin']!.rodzaj).toBe('planowane')
    expect(PROWIENIENCJA['Nadwyżka ponad normę']!.rodzaj).toBe('planowane')
  })

  it('marks headcount as reconstructed, because the schema cannot store it', () => {
    expect(PROWIENIENCJA['Stan zatrudnienia']!.rodzaj).toBe('odtwarzane')
  })

  it('the overtime caveat says out loud that it is not Kodeks pracy overtime', () => {
    // This is the single most quotable — and most misquotable — number on the screen.
    const uwaga = PROWIENIENCJA['Nadwyżka ponad normę']!.uwaga
    expect(uwaga).toMatch(/NIE są nadgodziny/)
    expect(uwaga).toMatch(/norma TYGODNIOWA|normę TYGODNIOWĄ|wyłącznie norma TYGODNIOWA/i)
    expect(uwaga).toMatch(/ZANIŻA/)
  })

  it('every entry carries a non-trivial caveat', () => {
    for (const [label, p] of Object.entries(PROWIENIENCJA)) {
      expect(p.zrodlo.length, `${label}: zrodlo`).toBeGreaterThan(4)
      // A caveat short enough to be a placeholder is worse than none — it looks like diligence.
      expect(p.uwaga.length, `${label}: uwaga`).toBeGreaterThan(40)
    }
  })
})

describe('formatters', () => {
  it('renders the badge as source · kind', () => {
    expect(opisProwieniencji(PROWIENIENCJA['Suma godzin']!)).toBe('grafik (czas zaplanowany) · planowane')
  })

  it('states the window with its working-day count', () => {
    expect(opisOkna('2026-07-01', '2026-07-31', 23)).toBe('Okres 2026-07-01 – 2026-07-31 · 23 dni roboczych')
  })
})
