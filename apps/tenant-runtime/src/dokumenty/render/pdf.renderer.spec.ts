import {
  buildEwidencjaPdfContent,
  buildNadgodzinyPdfContent,
  buildKeduPdfContent,
  renderContentsToHtml,
  normalizePdfDeterminism,
  WATERMARK_TEXT,
} from './pdf.renderer'
import type { EwidencjaRow, Period } from '../rcp.util'
import type { OvertimeSummary } from '../overtime.util'
import type { KeduModel } from '../kedu.util'

const utc = (iso: string) => new Date(iso)
const period: Period = { start: utc('2026-06-08T00:00:00Z'), end: utc('2026-06-14T00:00:00Z') }

const employee = { employeeId: 'e1', imie: 'Anna', nazwisko: 'Kowalska' }

const rows: EwidencjaRow[] = [
  { date: '2026-06-08', firstIn: null, lastOut: null, workedMinutes: 480, breakMinutes: 30, anomalie: [] },
  { date: '2026-06-09', firstIn: null, lastOut: null, workedMinutes: null, breakMinutes: 0, anomalie: ['BRAK_RCP'] },
  {
    date: '2026-06-10',
    firstIn: null,
    lastOut: null,
    workedMinutes: null,
    breakMinutes: 0,
    absence: 'URLOP_WYPOCZYNKOWY',
    anomalie: [],
  },
]

const summary: OvertimeSummary = {
  ot50Min: 120,
  ot100Min: 60,
  nightMin: 30,
  sundayMin: 0,
  holidayMin: 0,
  ot100NightSundayHolidayMin: 30,
  count: 2,
  daysWithoutRcp: 1,
}

const summaryWithWarning: OvertimeSummary = {
  ...summary,
  annualLimitWarning: { projectedMin: 20000, limitMin: 15000 },
}

const keduModel: KeduModel = {
  demo: true,
  wersjaSchematu: 'KEDU 5.4 (WERSJA POGLĄDOWA DEMO — NIE DO WYSYŁKI ZUS)',
  dra: {
    platnikNip: '0000000000',
    platnikNazwa: '4Mobility (DANE SYNTETYCZNE — WERSJA DEMO)',
    kodTerminu: '3',
    okresOd: '2026-06-08',
    okresDo: '2026-06-14',
    liczbaUbezpieczonych: 1,
  },
  rca: [
    {
      employeeId: 'e1',
      pesel: '90010112345',
      imie: 'Anna',
      nazwisko: 'Kowalska',
      workedMinutes: 480,
      ot50Min: 0,
      ot100Min: 0,
    },
  ],
  rsa: [],
}

describe('pdf.renderer — pure content builders (structured, testable without a browser)', () => {
  it('buildEwidencjaPdfContent: nagłówek meta + tabela dni/godzin, BEZ pre-formatowanych `|`-stringów', () => {
    const content = buildEwidencjaPdfContent(employee, period, rows)
    expect(content.meta.some((m) => m.value.includes('Kowalska'))).toBe(true)
    expect(content.meta.some((m) => m.value.includes('2026-06-08'))).toBe(true)
    expect(content.tables?.[0]?.table.rows.some((r) => r.worked?.includes('480'))).toBe(true)
    expect(content.tables?.[0]?.table.columns.map((c) => c.header)).toEqual(['Data', 'Przepracowano', 'Przerwy', 'Absencja', 'Uwagi'])
    expect(content.watermark).toBe(WATERMARK_TEXT)
    // DOK-3 null-policy: brak danych != 0h
    expect(content.tables?.[0]?.table.rows[1]?.worked).toBe('brak danych')
  })

  it('buildNadgodzinyPdfContent: tabela metryk + ostrzeżenie roczne jako note tone=warn', () => {
    const content = buildNadgodzinyPdfContent(employee, period, summaryWithWarning)
    const table = content.tables?.[0]?.table
    expect(table?.rows.some((r) => (r.metric ?? '').includes('50%') && r.value === '120 min')).toBe(true)
    expect(content.notes?.[0]?.tone).toBe('warn')
    expect(content.notes?.[0]?.text).toMatch(/OSTRZEŻENIE/)
    expect(content.watermark).toBe(WATERMARK_TEXT)
  })

  it('buildNadgodzinyPdfContent: brak ostrzeżenia => notes puste', () => {
    const content = buildNadgodzinyPdfContent(employee, period, summary)
    expect(content.notes).toEqual([])
  })

  it('buildKeduPdfContent: dwie tabele (RCA/RSA) + meta DRA', () => {
    const content = buildKeduPdfContent(keduModel)
    expect(content.tables?.[0]?.heading).toMatch(/RCA/)
    expect(content.tables?.[0]?.table.rows[0]?.pesel).toBe('90010112345')
    expect(content.tables?.[1]?.heading).toMatch(/RSA/)
    expect(content.notes?.[0]?.text).toMatch(/brak absencji/)
    expect(content.watermark).toBe(WATERMARK_TEXT)
  })

  it('znak wodny to dokładnie tekst wymagany przez SPEC §0', () => {
    expect(WATERMARK_TEXT).toBe('WERSJA DEMO — dane syntetyczne — nie do obrotu prawnego / nie do wysyłki ZUS')
  })
})

describe('pdf.renderer — renderContentsToHtml (pure HTML string builder, no browser needed)', () => {
  it('zero znaków `|` użytych jako układ tabeli (kryterium akceptacji)', () => {
    const html = renderContentsToHtml([buildEwidencjaPdfContent(employee, period, rows)])
    // The only `|` that could legitimately appear is inside actual data values, none of which do here.
    expect(html).not.toContain('|')
  })

  it('nagłówek tabeli w prawdziwym <thead> (powtarzalny na łamaniu stron przez przeglądarkę)', () => {
    const html = renderContentsToHtml([buildEwidencjaPdfContent(employee, period, rows)])
    expect(html).toContain('<thead>')
    expect(html).toContain('<th class="mono">Data</th>')
  })

  it('wiersze tabeli mają break-inside:avoid (żaden wiersz nie jest przecinany przez granicę stron)', () => {
    const html = renderContentsToHtml([buildEwidencjaPdfContent(employee, period, rows)])
    expect(html).toMatch(/tr\s*\{[^}]*break-inside:\s*avoid/)
  })

  it('DOKŁADNIE JEDEN element znaku wodnego w źródle HTML (Chrome powiela position:fixed na każdej fizycznej stronie)', () => {
    const html = renderContentsToHtml([
      buildEwidencjaPdfContent(employee, period, rows),
      buildNadgodzinyPdfContent(employee, period, summary),
    ])
    const matches = html.match(/class="watermark"/g) ?? []
    expect(matches.length).toBe(1)
    expect(html).toMatch(/\.watermark\s*\{[^}]*position:\s*fixed/)
  })

  it('wiele sekcji => break-before:page na drugiej i kolejnych (jedna sekcja PDF-a per pracownik)', () => {
    const html = renderContentsToHtml([
      buildEwidencjaPdfContent(employee, period, rows),
      buildNadgodzinyPdfContent(employee, period, summary),
    ])
    expect((html.match(/class="doc-section page-break"/g) ?? []).length).toBe(1)
    expect((html.match(/class="doc-section"/g) ?? []).length).toBe(1) // first section has no page-break class
  })

  it('zero zadań sieciowych: brak referencji http(s):// w wygenerowanym dokumencie (fonty jako data: URI)', () => {
    const html = renderContentsToHtml([buildEwidencjaPdfContent(employee, period, rows)])
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('pusta lista sekcji nadal generuje poprawny dokument z jednym znakiem wodnym', () => {
    const html = renderContentsToHtml([])
    expect(html).toContain(WATERMARK_TEXT)
    expect((html.match(/class="watermark"/g) ?? []).length).toBe(1)
  })

  it('treść jest poprawnie escape’owana (brak wstrzyknięcia znaczników z danych pracownika)', () => {
    const html = renderContentsToHtml([
      buildEwidencjaPdfContent({ employeeId: 'e2', imie: '<script>', nazwisko: 'X' }, period, []),
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('pdf.renderer — normalizePdfDeterminism (byte-length-preserving CreationDate/ModDate fix)', () => {
  it('zamienia D:<14 cyfr><strefa> na stały placeholder tej samej długości', () => {
    const fake = Buffer.from(
      "1 0 obj<</CreationDate (D:20260804095431+00'00')/ModDate (D:20260804095435+01'30')>>endobj",
      'latin1',
    )
    const normalized = normalizePdfDeterminism(fake)
    expect(normalized.length).toBe(fake.length)
    expect(normalized.toString('latin1')).toContain("D:20000101000000+00'00'")
    expect(normalized.toString('latin1')).toContain("D:20000101000000+01'30'")
  })

  it('dwa bufory różniące się TYLKO datą stają się identyczne po normalizacji', () => {
    const a = Buffer.from("(D:20260804095431+00'00')", 'latin1')
    const b = Buffer.from("(D:20270101000000+00'00')", 'latin1')
    expect(normalizePdfDeterminism(a).equals(normalizePdfDeterminism(b))).toBe(true)
  })

  it('bufor bez znacznika daty przechodzi bez zmian', () => {
    const buf = Buffer.from('%PDF-1.4 no dates here', 'latin1')
    expect(normalizePdfDeterminism(buf).equals(buf)).toBe(true)
  })
})
