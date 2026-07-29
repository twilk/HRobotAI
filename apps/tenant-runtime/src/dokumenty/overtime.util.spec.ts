import {
  overtimeDaily,
  overtimeWeekly,
  overtimeNightSundayHoliday,
  overtimeSummary,
} from './overtime.util'
import { pairEvents, type EwidencjaRow, type RcpEventLite, type Period } from './rcp.util'
import { DEMO_CONFIG } from './dokumenty.config'

const utc = (iso: string) => new Date(iso)
const ev = (type: RcpEventLite['type'], iso: string, employeeId = 'e1'): RcpEventLite => ({
  employeeId,
  occurredAt: utc(iso),
  type,
})

// Minimal EwidencjaRow builder for the overtime layer (only `workedMinutes`/`anomalie` are read).
const row = (date: string, workedMinutes: number | null, anomalie: EwidencjaRow['anomalie'] = []): EwidencjaRow => ({
  date,
  firstIn: null,
  lastOut: null,
  workedMinutes,
  breakMinutes: 0,
  anomalie,
})

const oneWeek: Period = { start: utc('2026-06-08T00:00:00Z'), end: utc('2026-06-14T00:00:00Z') } // Mon..Sun

describe('overtime.util — overtimeDaily (50%, DOK-4)', () => {
  it('ponad 8h/dobę => nadgodziny 50%', () => {
    expect(overtimeDaily(600, DEMO_CONFIG.normaDobowaMin)).toEqual({ normalMin: 480, ot50Min: 120 })
  })
  it('dokładnie norma => 0 nadgodzin', () => {
    expect(overtimeDaily(480, DEMO_CONFIG.normaDobowaMin)).toEqual({ normalMin: 480, ot50Min: 0 })
  })
  it('poniżej normy => normalMin = worked, 0 nadgodzin', () => {
    expect(overtimeDaily(300, DEMO_CONFIG.normaDobowaMin)).toEqual({ normalMin: 300, ot50Min: 0 })
  })
  it('norma czytana z argumentu, nie zahardkodowana', () => {
    expect(overtimeDaily(500, 420)).toEqual({ normalMin: 420, ot50Min: 80 })
  })
})

describe('overtime.util — overtimeWeekly (100% średniotygodniowe, DOK-4 no double-count)', () => {
  it('godziny już rozliczone jako dobowe NIE liczą się drugi raz jako tygodniowe', () => {
    // 5 dni × 10h = 50h. Dobowe OT = 5×2h = 10h. Norma tyg. = 40h. => 0h średniotygodniowych.
    const rows = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'].map((d) => row(d, 600))
    const { ot100Min } = overtimeWeekly(rows, DEMO_CONFIG.normaTygodnMin, oneWeek)
    expect(ot100Min).toBe(0)
    // Kontrolnie: naiwne (totalWorked - baseline) dałoby 3000-2400 = 600 min (double-count).
    const naive = 3000 - DEMO_CONFIG.normaTygodnMin
    expect(naive).toBe(600)
    expect(ot100Min).not.toBe(naive)
  })

  it('praca w sobotę (bez dobowych OT) => nadgodziny średniotygodniowe 100%', () => {
    // Pn–Pt 8h (=40h) + sobota 8h = 48h; brak dobowych OT => 8h = 480 min tygodniowych.
    const rows = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'].map((d) => row(d, 480))
    expect(overtimeWeekly(rows, DEMO_CONFIG.normaTygodnMin, oneWeek).ot100Min).toBe(480)
  })

  it('dobowe + sobotnie razem: dobowe wykluczone z tygodniowych', () => {
    // Pn–Pt 10h (=50h, w tym 10h dobowych) + sobota 8h = 58h.
    const rows = [
      row('2026-06-08', 600),
      row('2026-06-09', 600),
      row('2026-06-10', 600),
      row('2026-06-11', 600),
      row('2026-06-12', 600),
      row('2026-06-13', 480),
    ]
    // 3480 - 600(dobowe) - 2400(norma) = 480. Naiwne dałoby 3480-2400 = 1080.
    expect(overtimeWeekly(rows, DEMO_CONFIG.normaTygodnMin, oneWeek).ot100Min).toBe(480)
  })

  it('dni z workedMinutes null (brak RCP) wykluczone z podstawy', () => {
    const rows = [row('2026-06-08', 480), row('2026-06-09', null, ['BRAK_RCP']), row('2026-06-10', 480)]
    // total = 960, baseline 2400 => 0 (null nie dodaje ani nie karze).
    expect(overtimeWeekly(rows, DEMO_CONFIG.normaTygodnMin, oneWeek).ot100Min).toBe(0)
  })
})

describe('overtime.util — overtimeNightSundayHoliday (100%, DOK-5)', () => {
  it('praca w niedzielę => 100% (cała sesja)', () => {
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-06-07T08:00:00Z'), // 2026-06-07 to niedziela
      ev('WYJSCIE', '2026-06-07T14:00:00Z'),
    ])
    const r = overtimeNightSundayHoliday(sessions, DEMO_CONFIG)
    expect(r.sundayMin).toBe(360)
    expect(r.ot100Min).toBe(360)
  })

  it('praca w święto (1 maja) => 100%', () => {
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-05-01T08:00:00Z'), // 2026-05-01 w tablicy świąt demo
      ev('WYJSCIE', '2026-05-01T12:00:00Z'),
    ])
    const r = overtimeNightSundayHoliday(sessions, DEMO_CONFIG)
    expect(r.holidayMin).toBe(240)
    expect(r.ot100Min).toBe(240)
  })

  it('praca w porze nocnej (22:00–06:00 lokalnie) => minuty nocne 100%', () => {
    // 2026-06-08 20:00Z–2026-06-09 00:00Z => lokalnie CEST 22:00–02:00 = 4h w porze nocnej.
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-06-08T20:00:00Z'),
      ev('WYJSCIE', '2026-06-09T00:00:00Z'),
    ])
    const r = overtimeNightSundayHoliday(sessions, DEMO_CONFIG)
    expect(r.nightMin).toBe(240)
    expect(r.ot100Min).toBe(240)
  })

  it('dzień zwykły, poza nocą, bez święta => 0', () => {
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-06-08T06:00:00Z'), // poniedziałek, 08:00–14:00 lokalnie
      ev('WYJSCIE', '2026-06-08T12:00:00Z'),
    ])
    expect(overtimeNightSundayHoliday(sessions, DEMO_CONFIG).ot100Min).toBe(0)
  })
})

describe('overtime.util — overtimeSummary', () => {
  const rows = [
    row('2026-06-08', 600), // 2h dobowych
    row('2026-06-09', 600), // 2h dobowych
    row('2026-06-10', 480),
    row('2026-06-11', null, ['BRAK_RCP']),
    row('2026-06-12', 480),
  ]

  it('sumuje ot50, ot100, count, dni bez RCP; limit roczny to tylko ostrzeżenie', () => {
    const s = overtimeSummary(oneWeek, rows, [], DEMO_CONFIG)
    expect(s.ot50Min).toBe(240) // 2×120
    expect(s.count).toBe(2) // dwa dni z dobowymi OT
    expect(s.daysWithoutRcp).toBe(1)
    expect(s.annualLimitWarning).toBeUndefined() // poniżej progu
  })

  it('ostrzeżenie o limicie rocznym gdy suma narastająco przekracza próg (bez blokady)', () => {
    const s = overtimeSummary(oneWeek, rows, [], DEMO_CONFIG, DEMO_CONFIG.limitRocznyNadgodzinMin - 100)
    expect(s.annualLimitWarning).toBeDefined()
    expect(s.annualLimitWarning!.projectedMin).toBeGreaterThan(DEMO_CONFIG.limitRocznyNadgodzinMin)
  })

  it('dni null nie wchodzą do podstawy nadgodzin', () => {
    const s = overtimeSummary(oneWeek, rows, [], DEMO_CONFIG)
    // ot50 liczone tylko z dni numerycznych (600,600,480,480) — null pominięty.
    expect(s.ot50Min).toBe(240)
  })
})
