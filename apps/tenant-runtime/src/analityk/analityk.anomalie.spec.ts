import {
  wykryjAnomalie,
  PROG_ABSENCJA_PP,
  PROG_ABSENCJA_PP_WYSOKA,
  PROG_DECYZJA_H,
  PROG_KOLEJKA_SZT,
  PROG_NADWYZKA_H,
  PROG_ZATRUDNIENIE_OS,
  type KodAnomalii,
} from './analityk.anomalie.js'
import type { PorownanieKpi } from './analityk.service.js'

/** A deliberately calm baseline: no rule fires against itself. */
const BASE: PorownanieKpi = {
  od: '2026-06-01',
  do: '2026-06-14',
  stanZatrudnienia: 50,
  wskaznikAbsencji: 0.05,
  sumaGodzin: 3500,
  nadwyzkaPonadNorme: 100,
  wnioskiWToku: 10,
  medianaGodzinDoDecyzji: 20,
}

const kpi = (over: Partial<PorownanieKpi>): PorownanieKpi => ({ ...BASE, ...over })
const codes = (current: Partial<PorownanieKpi>, previous: Partial<PorownanieKpi> = {}): KodAnomalii[] =>
  wykryjAnomalie(kpi(current), kpi(previous)).map((a) => a.kod)

describe('wykryjAnomalie', () => {
  it('reports NOTHING when the two windows are identical', () => {
    expect(wykryjAnomalie(BASE, BASE)).toEqual([])
  })

  it('reports nothing when every metric IMPROVED', () => {
    expect(codes({ wskaznikAbsencji: 0.02, nadwyzkaPonadNorme: 40, wnioskiWToku: 2, medianaGodzinDoDecyzji: 5 })).toEqual([])
  })

  describe('ABSENCJA_SKOK', () => {
    it('fires when absence rises past the point threshold AND rises by half again', () => {
      // 5% → 9% = +4 p.p. (over the 3 p.p. high bar) and +80% relative.
      const [a] = wykryjAnomalie(kpi({ wskaznikAbsencji: 0.09 }), BASE)
      expect(a?.kod).toBe('ABSENCJA_SKOK')
      expect(a?.waga).toBe('wysoka')
      expect(a?.zmiana).toBe(0.04)
      expect(a?.zmianaWzgledna).toBe(0.8)
    })

    it('grades a smaller rise as medium severity', () => {
      // 2% → 4% = +2 p.p.: over the reporting bar, under the high bar, and +100% relative.
      const [a] = wykryjAnomalie(kpi({ wskaznikAbsencji: 0.04 }), kpi({ wskaznikAbsencji: 0.02 }))
      expect(a?.kod).toBe('ABSENCJA_SKOK')
      expect(a?.waga).toBe('srednia')
    })

    it('stays SILENT on a large relative jump that is tiny in absolute terms', () => {
      // 0.1% → 0.6% is +500% relative but only +0.5 p.p. — noise in a small tenant, not a spike.
      expect(codes({ wskaznikAbsencji: 0.006 }, { wskaznikAbsencji: 0.001 })).not.toContain('ABSENCJA_SKOK')
    })

    it('stays SILENT on a large absolute rise off an already-high base', () => {
      // 40% → 42% is +2 p.p. but only +5% relative — no meaningful change in behaviour.
      expect(codes({ wskaznikAbsencji: 0.42 }, { wskaznikAbsencji: 0.4 })).not.toContain('ABSENCJA_SKOK')
    })

    it('does not fire exactly AT the reporting threshold minus a hair', () => {
      const previous = 0.02
      const justUnder = previous + PROG_ABSENCJA_PP - 0.0001
      expect(codes({ wskaznikAbsencji: justUnder }, { wskaznikAbsencji: previous })).not.toContain('ABSENCJA_SKOK')
    })

    it('escalates to high severity exactly at the high threshold', () => {
      const previous = 0.02
      const [a] = wykryjAnomalie(
        kpi({ wskaznikAbsencji: previous + PROG_ABSENCJA_PP_WYSOKA }),
        kpi({ wskaznikAbsencji: previous }),
      )
      expect(a?.waga).toBe('wysoka')
    })

    it('NEVER fires when either side is unknown — an unknown is not a change', () => {
      expect(codes({ wskaznikAbsencji: 0.09 }, { wskaznikAbsencji: null })).not.toContain('ABSENCJA_SKOK')
      expect(codes({ wskaznikAbsencji: null }, { wskaznikAbsencji: 0.01 })).not.toContain('ABSENCJA_SKOK')
    })

    it('fires off a ZERO baseline on the absolute rise alone (no percentage exists)', () => {
      const [a] = wykryjAnomalie(kpi({ wskaznikAbsencji: 0.08 }), kpi({ wskaznikAbsencji: 0 }))
      expect(a?.kod).toBe('ABSENCJA_SKOK')
      expect(a?.zmianaWzgledna).toBeNull()
    })
  })

  describe('NADWYZKA_SKOK', () => {
    it('fires on a rise that is both relatively and absolutely large', () => {
      // 100h → 160h = +60h and +60%.
      const [a] = wykryjAnomalie(kpi({ nadwyzkaPonadNorme: 160 }), BASE)
      expect(a?.kod).toBe('NADWYZKA_SKOK')
      expect(a?.zmiana).toBe(60)
    })

    it('stays silent when the absolute rise is small even at a big percentage', () => {
      // 4h → 12h is +200% but only +8h.
      expect(codes({ nadwyzkaPonadNorme: 12 }, { nadwyzkaPonadNorme: 4 })).not.toContain('NADWYZKA_SKOK')
    })

    it('stays silent when the absolute rise is large but the percentage is not', () => {
      // 1000h → 1025h is +25h but only +2.5%.
      expect(codes({ nadwyzkaPonadNorme: 1025 }, { nadwyzkaPonadNorme: 1000 })).not.toContain('NADWYZKA_SKOK')
    })

    it('fires exactly at the absolute threshold when the relative bar is also cleared', () => {
      expect(codes({ nadwyzkaPonadNorme: 20 + PROG_NADWYZKA_H }, { nadwyzkaPonadNorme: 20 })).toContain('NADWYZKA_SKOK')
    })
  })

  describe('KOLEJKA_WNIOSKOW', () => {
    it('fires when the backlog grows sharply in both terms', () => {
      // 10 → 20 = +10 and +100%.
      expect(codes({ wnioskiWToku: 20 })).toContain('KOLEJKA_WNIOSKOW')
    })

    it('stays silent on a small tenant doubling from 1 to 2', () => {
      expect(codes({ wnioskiWToku: 2 }, { wnioskiWToku: 1 })).not.toContain('KOLEJKA_WNIOSKOW')
    })

    it('stays silent when a big queue grows only slightly', () => {
      // 100 → 106 is +6 but only +6%.
      expect(codes({ wnioskiWToku: 106 }, { wnioskiWToku: 100 })).not.toContain('KOLEJKA_WNIOSKOW')
    })

    it('fires exactly at the absolute threshold when the relative bar is cleared', () => {
      expect(codes({ wnioskiWToku: 4 + PROG_KOLEJKA_SZT }, { wnioskiWToku: 4 })).toContain('KOLEJKA_WNIOSKOW')
    })
  })

  describe('CZAS_DECYZJI', () => {
    it('fires when the median decision time degrades sharply', () => {
      // 20h → 40h = +20h and +100%.
      expect(codes({ medianaGodzinDoDecyzji: 40 })).toContain('CZAS_DECYZJI')
    })

    it('stays silent on a small absolute slowdown', () => {
      expect(codes({ medianaGodzinDoDecyzji: 4 }, { medianaGodzinDoDecyzji: 1 })).not.toContain('CZAS_DECYZJI')
    })

    it('NEVER fires when nothing was decided in one of the windows', () => {
      expect(codes({ medianaGodzinDoDecyzji: 90 }, { medianaGodzinDoDecyzji: null })).not.toContain('CZAS_DECYZJI')
      expect(codes({ medianaGodzinDoDecyzji: null })).not.toContain('CZAS_DECYZJI')
    })

    it('fires exactly at the absolute threshold when the relative bar is cleared', () => {
      expect(codes({ medianaGodzinDoDecyzji: 10 + PROG_DECYZJA_H }, { medianaGodzinDoDecyzji: 10 })).toContain('CZAS_DECYZJI')
    })
  })

  describe('SPADEK_ZATRUDNIENIA', () => {
    it('fires on a meaningful headcount drop and grades it high', () => {
      // 50 → 45 = −5 people = −10%.
      const [a] = wykryjAnomalie(kpi({ stanZatrudnienia: 45 }), BASE)
      expect(a?.kod).toBe('SPADEK_ZATRUDNIENIA')
      expect(a?.waga).toBe('wysoka')
      expect(a?.zmiana).toBe(-5)
    })

    it('NEVER fires on headcount GROWTH', () => {
      expect(codes({ stanZatrudnienia: 80 })).not.toContain('SPADEK_ZATRUDNIENIA')
    })

    it('stays silent on a one-person drop in a large team', () => {
      expect(codes({ stanZatrudnienia: 199 }, { stanZatrudnienia: 200 })).not.toContain('SPADEK_ZATRUDNIENIA')
    })

    it('fires exactly at the absolute threshold when the relative bar is cleared', () => {
      expect(codes({ stanZatrudnienia: 20 - PROG_ZATRUDNIENIE_OS }, { stanZatrudnienia: 20 })).toContain(
        'SPADEK_ZATRUDNIENIA',
      )
    })
  })

  describe('ordering and composition', () => {
    it('returns every rule that fired, high severity first', () => {
      const result = wykryjAnomalie(
        kpi({ stanZatrudnienia: 40, wskaznikAbsencji: 0.12, nadwyzkaPonadNorme: 200, wnioskiWToku: 30, medianaGodzinDoDecyzji: 60 }),
        BASE,
      )
      expect(result.map((a) => a.kod)).toEqual([
        'ABSENCJA_SKOK',
        'SPADEK_ZATRUDNIENIA',
        'NADWYZKA_SKOK',
        'KOLEJKA_WNIOSKOW',
        'CZAS_DECYZJI',
      ])
      expect(result.slice(0, 2).every((a) => a.waga === 'wysoka')).toBe(true)
    })

    it('carries both compared values on every finding so the UI can show its reasoning', () => {
      const [a] = wykryjAnomalie(kpi({ nadwyzkaPonadNorme: 160 }), BASE)
      expect(a?.wartoscBiezaca).toBe(160)
      expect(a?.wartoscPoprzednia).toBe(100)
      expect(a?.opis).toContain('100')
      expect(a?.opis).toContain('160')
    })
  })
})
