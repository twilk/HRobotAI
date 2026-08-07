import { describe, expect, it } from 'vitest'
import {
  absenceTone,
  barHeights,
  BRAK_DANYCH,
  chartMax,
  defaultRange,
  deltaTone,
  formatDecisionTime,
  formatDelta,
  formatDeltaPunkty,
  formatHours,
  formatNumber,
  formatPercent,
  leaveTypeLabel,
  linePoints,
  monthLabel,
  monthToDateRange,
  podsumowanieToCsv,
  shortId,
  stackOffsets,
  toCsv,
  toIsoDate,
  xPositions,
  yearToDateRange,
  zebraneUwagi,
  type PodsumowanieResult,
} from './analityk'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node', so these cover only the pure
// helpers the Analityk screen relies on: Polish formatting, the tri-state tone logic, the SVG chart
// geometry (the web-kit ships no charting library) and the CSV export. No network.

describe('formatPercent', () => {
  it('renders a 0..1 ratio as a Polish percentage with one decimal', () => {
    expect(formatPercent(0.2333)).toBe('23,3%')
    expect(formatPercent(0.25)).toBe('25,0%')
    expect(formatPercent(0)).toBe('0,0%')
  })

  it('NEVER renders an unknown rate as 0% — null/undefined always render a dash', () => {
    expect(formatPercent(null)).toBe(BRAK_DANYCH)
    expect(formatPercent(undefined)).toBe(BRAK_DANYCH)
  })

  it('falls back to a dash for a non-finite value rather than showing NaN%', () => {
    expect(formatPercent(Number.NaN)).toBe(BRAK_DANYCH)
  })
})

describe('formatHours / formatNumber', () => {
  it('drops the decimal for a whole number of hours', () => {
    expect(formatHours(102)).toBe('102 h')
  })

  it('uses a Polish decimal comma for a fractional value', () => {
    expect(formatHours(9.27)).toBe('9,3 h')
  })

  it('renders an unknown value as a dash, not 0 h', () => {
    expect(formatHours(null)).toBe(BRAK_DANYCH)
  })

  it('formats plain numbers the same way', () => {
    expect(formatNumber(24.33)).toBe('24,3')
    expect(formatNumber(3)).toBe('3')
    expect(formatNumber(null)).toBe(BRAK_DANYCH)
  })
})

describe('formatDecisionTime', () => {
  it('keeps sub-day medians in hours', () => {
    expect(formatDecisionTime(12)).toBe('12 h')
    expect(formatDecisionTime(23.9)).toBe('23,9 h')
  })

  it('switches to days once a decision takes longer than a day', () => {
    expect(formatDecisionTime(36)).toBe('1,5 dnia')
    expect(formatDecisionTime(48)).toBe('2 dnia')
  })

  it('renders "no decisions taken" as a dash rather than 0 h', () => {
    expect(formatDecisionTime(null)).toBe(BRAK_DANYCH)
  })
})

describe('formatDelta / formatDeltaPunkty', () => {
  it('prefixes a positive delta with an explicit +', () => {
    expect(formatDelta(5)).toBe('+5')
  })

  it('keeps the minus sign for a negative delta without double-signing', () => {
    expect(formatDelta(-3)).toBe('-3')
  })

  it('renders exactly zero unsigned', () => {
    expect(formatDelta(0)).toBe('0')
  })

  it('renders an unknown delta as a dash', () => {
    expect(formatDelta(null)).toBe(BRAK_DANYCH)
  })

  it('expresses a rate delta in percentage points, not percent', () => {
    expect(formatDeltaPunkty(0.023)).toBe('+2,3 p.p.')
    expect(formatDeltaPunkty(-0.01)).toBe('-1 p.p.')
    expect(formatDeltaPunkty(null)).toBe(BRAK_DANYCH)
  })
})

describe('deltaTone', () => {
  it('reads growth as good by default (headcount, hours)', () => {
    expect(deltaTone(5)).toBe('good')
    expect(deltaTone(-5)).toBe('bad')
  })

  it('FLIPS the reading where lower is better (absence, backlog, time-to-decision)', () => {
    expect(deltaTone(5, true)).toBe('bad')
    expect(deltaTone(-5, true)).toBe('good')
  })

  it('never dresses up an unknown or unchanged figure as an improvement', () => {
    expect(deltaTone(0)).toBe('neutral')
    expect(deltaTone(0, true)).toBe('neutral')
    expect(deltaTone(null)).toBe('neutral')
    expect(deltaTone(undefined, true)).toBe('neutral')
  })
})

describe('absenceTone', () => {
  it('reads under 4% as healthy', () => {
    expect(absenceTone(0.02)).toBe('good')
  })

  it('reads 4–8% as worth watching', () => {
    expect(absenceTone(0.04)).toBe('neutral')
    expect(absenceTone(0.08)).toBe('neutral')
  })

  it('reads above 8% as a problem', () => {
    expect(absenceTone(0.12)).toBe('bad')
  })

  it('stays neutral for an unknown rate', () => {
    expect(absenceTone(null)).toBe('neutral')
  })
})

describe('monthLabel / leaveTypeLabel / shortId', () => {
  it('renders a YYYY-MM key as an abbreviated Polish month', () => {
    expect(monthLabel('2026-06')).toBe('cze 2026')
    expect(monthLabel('2026-01')).toBe('sty 2026')
    expect(monthLabel('2026-10')).toBe('paź 2026')
  })

  it('returns an unparseable month key unchanged rather than rendering NaN', () => {
    expect(monthLabel('nie-miesiac')).toBe('nie-miesiac')
    expect(monthLabel('2026-13')).toBe('2026-13')
  })

  it('humanizes a raw leave-type enum string', () => {
    expect(leaveTypeLabel('URLOP_WYPOCZYNKOWY')).toBe('Urlop wypoczynkowy')
    expect(leaveTypeLabel('CHOROBOWE')).toBe('Chorobowe')
  })

  it('shortens an id into a stable handle (the payload carries no names)', () => {
    expect(shortId('e1a2b3c4-5678-90ab-cdef-1234567890ab')).toBe('#e1a2b3c4')
  })
})

describe('chart geometry', () => {
  it('never scales against a zero maximum (which would divide by zero)', () => {
    expect(chartMax([0, 0, 0])).toBe(1)
    expect(chartMax([])).toBe(1)
    expect(chartMax([3, 9, 5])).toBe(9)
  })

  it('scales bar heights proportionally to the largest value', () => {
    expect(barHeights([10, 5, 0], 100)).toEqual([100, 50, 1])
  })

  it('keeps a 1px stub for a zero value so "measured and zero" stays visible', () => {
    expect(barHeights([0, 0], 100)).toEqual([1, 1])
  })

  it('spaces points evenly across the width, centring a lone point', () => {
    expect(xPositions(3, 100)).toEqual([0, 50, 100])
    expect(xPositions(1, 100)).toEqual([50])
    expect(xPositions(0, 100)).toEqual([])
  })

  it('y-flips a line series so a larger value sits higher', () => {
    // max = 10 → 10 maps to y=0 (top), 0 maps to y=40 (bottom), 5 maps to the middle.
    expect(linePoints([10, 5, 0], 100, 40)).toBe('0,0 50,20 100,40')
  })

  it('renders nothing for an empty series instead of a broken path', () => {
    expect(linePoints([], 100, 40)).toBe('')
  })

  it('lays out a 100%-stacked bar as cumulative offsets summing to 100', () => {
    const parts = stackOffsets([5, 2, 3])
    expect(parts).toEqual([
      { offset: 0, width: 50 },
      { offset: 50, width: 20 },
      { offset: 70, width: 30 },
    ])
  })

  it('collapses a zero-total stack to zero widths rather than a misleading full bar', () => {
    expect(stackOffsets([0, 0])).toEqual([
      { offset: 0, width: 0 },
      { offset: 0, width: 0 },
    ])
  })
})

describe('range presets', () => {
  const today = new Date('2026-06-14T13:45:00.000Z')

  it('defaults to the last 30 days ending today', () => {
    expect(defaultRange(today)).toEqual({ od: '2026-05-16', do: '2026-06-14' })
  })

  it('offers the current month to date', () => {
    expect(monthToDateRange(today)).toEqual({ od: '2026-06-01', do: '2026-06-14' })
  })

  it('offers the current year to date', () => {
    expect(yearToDateRange(today)).toEqual({ od: '2026-01-01', do: '2026-06-14' })
  })

  it('formats a date as the YYYY-MM-DD the API expects', () => {
    expect(toIsoDate(today)).toBe('2026-06-14')
  })
})

describe('toCsv', () => {
  it('uses a semicolon separator (Polish Excel) and CRLF line endings', () => {
    expect(toCsv(['A', 'B'], [['x', 'y']])).toBe('A;B\r\nx;y')
  })

  it('quotes a field containing the separator so the columns cannot shift', () => {
    expect(toCsv(['A'], [['Serwis; Warszawa']])).toBe('A\r\n"Serwis; Warszawa"')
  })

  it('doubles an embedded quote per RFC 4180', () => {
    expect(toCsv(['A'], [['on "duty"']])).toBe('A\r\n"on ""duty"""')
  })

  it('renders a null cell as empty rather than the string "null"', () => {
    expect(toCsv(['A', 'B'], [[null, 1]])).toBe('A;B\r\n;1')
  })

  it('formats numbers with the Polish decimal comma', () => {
    expect(toCsv(['A'], [[24.333]])).toBe('A\r\n24,33')
  })
})

describe('podsumowanieToCsv', () => {
  const meta = (uwagi: string[] = []) => ({ od: '2026-06-01', do: '2026-06-14', unitIds: null, dniRobocze: 10, uwagi })

  const summary = {
    meta: meta(),
    zatrudnienie: { meta: meta(), stanNaKoniec: 3, przyjecia: 1, odejscia: 1, rotacjaWOkresie: 0.3333 },
    absencje: { meta: meta(), dniNieobecnosci: 7, wskaznik: 0.2333 },
    czasPracy: { meta: meta(), sumaGodzin: 102, nadwyzkaPonadNorme: 10, niedoborDoNormy: 8, sredniaDzienna: 9.27 },
    urlopy: { meta: meta(), wykorzystaneDni: 5, srednieSaldo: 24.33 },
    wnioski: { meta: meta(), wToku: 3, medianaGodzinDoDecyzji: 12, odsetekOdrzucen: 0.3333 },
  } as unknown as PodsumowanieResult

  it('titles the export with the analysed range', () => {
    expect(podsumowanieToCsv(summary).split('\r\n')[0]).toBe('Analityk HR 2026-06-01 – 2026-06-14')
  })

  it('exports every headline KPI as its own row', () => {
    const csv = podsumowanieToCsv(summary)
    expect(csv).toContain('Stan zatrudnienia na koniec;3;os.')
    expect(csv).toContain('Wskaźnik absencji;0,23;udział')
    expect(csv).toContain('Mediana czasu do decyzji;12;h')
  })

  it('names the working-time figure honestly — never the bare legal term "Nadgodziny"', () => {
    const csv = podsumowanieToCsv(summary)
    expect(csv).toContain('Nadwyżka ponad normę tygodniową (z grafiku, nie nadgodziny KP);10;h')
    expect(csv).not.toMatch(/(^|;)Nadgodziny;/m)
  })

  it('qualifies rotation with its period — a 14-day rate is not an annual one', () => {
    expect(podsumowanieToCsv(summary)).toContain('Rotacja w okresie (nie w ujęciu rocznym);0,33;udział')
  })

  it('leaves an unknown figure blank instead of exporting a fabricated 0', () => {
    const blank = { ...summary, absencje: { meta: meta(), dniNieobecnosci: 0, wskaznik: null } } as unknown as PodsumowanieResult
    expect(podsumowanieToCsv(blank)).toContain('Wskaźnik absencji;;udział')
  })

  it('APPENDS the caveats — the export is the path to a deck, and numbers must not travel alone', () => {
    const withUwagi = {
      ...summary,
      meta: meta(['Dni robocze liczone jako pn–pt; schemat nie zawiera kalendarza świąt.']),
      czasPracy: { ...summary.czasPracy, meta: meta(['To NADWYŻKA PONAD NORMĘ TYGODNIOWĄ, a nie nadgodziny w rozumieniu KP.']) },
    } as unknown as PodsumowanieResult

    const csv = podsumowanieToCsv(withUwagi)
    expect(csv).toContain('Zastrzeżenia')
    expect(csv).toContain('kalendarza świąt')
    expect(csv).toContain('nie nadgodziny w rozumieniu KP')
    // The caveats come LAST, after the figures they qualify.
    expect(csv.indexOf('Zastrzeżenia')).toBeGreaterThan(csv.indexOf('Stan zatrudnienia na koniec'))
  })

  it('omits the caveat block entirely rather than printing an empty heading', () => {
    expect(podsumowanieToCsv(summary)).not.toContain('Zastrzeżenia')
  })

  it('with no opts, stays byte-identical to the un-annotated export (backward compatible)', () => {
    expect(podsumowanieToCsv(summary)).toBe(podsumowanieToCsv(summary, {}))
  })

  it('prepends "Najemca;<companyName>" when a tenant name is supplied — the export must say WHOSE numbers these are', () => {
    const csv = podsumowanieToCsv(summary, { companyName: '4Mobility sp. z o.o.' })
    expect(csv.split('\r\n')[0]).toBe('Najemca;4Mobility sp. z o.o.')
    // The title line (which already carries the period) follows right after.
    expect(csv.split('\r\n')[1]).toBe('Analityk HR 2026-06-01 – 2026-06-14')
  })

  it('omits the Najemca line when no company name is available, rather than printing "Najemca;"', () => {
    const csv = podsumowanieToCsv(summary, { generatedAt: new Date('2026-06-15T10:30:00Z') })
    expect(csv).not.toMatch(/^Najemca;/m)
  })

  it('appends "Wygenerowano;<data>" when a generation timestamp is supplied — a snapshot needs a snapshot date', () => {
    const csv = podsumowanieToCsv(summary, { generatedAt: new Date('2026-06-15T10:30:00Z') })
    expect(csv).toContain('Wygenerowano;2026-06-15 10:30')
    // Comes right after the title line, before the KPI table.
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('Wygenerowano;2026-06-15 10:30')
  })

  it('combines Najemca + Wygenerowano + Zastrzeżenia in one export without dropping any of them', () => {
    const withUwagi = { ...summary, meta: meta(['Dni robocze liczone jako pn–pt.']) } as unknown as PodsumowanieResult
    const csv = podsumowanieToCsv(withUwagi, { companyName: '4Mobility sp. z o.o.', generatedAt: new Date('2026-06-15T10:30:00Z') })
    expect(csv).toContain('Najemca;4Mobility sp. z o.o.')
    expect(csv).toContain('Wygenerowano;2026-06-15 10:30')
    expect(csv).toContain('Zastrzeżenia')
    expect(csv).toContain('Dni robocze liczone jako pn–pt')
  })
})

describe('zebraneUwagi', () => {
  const meta = (uwagi: string[]) => ({ od: '2026-06-01', do: '2026-06-14', unitIds: null, dniRobocze: 10, uwagi })

  it('merges every aggregate’s caveats and de-duplicates them', () => {
    const data = {
      meta: meta(['wspólna']),
      zatrudnienie: { meta: meta(['wspólna', 'o odejściach']) },
      absencje: { meta: meta(['o absencji']) },
      czasPracy: { meta: meta(['o godzinach']) },
      urlopy: { meta: meta(['o urlopach']) },
      wnioski: { meta: meta(['o wnioskach']) },
    } as unknown as PodsumowanieResult

    expect(zebraneUwagi(data)).toEqual(['wspólna', 'o odejściach', 'o absencji', 'o godzinach', 'o urlopach', 'o wnioskach'])
  })
})
