import {
  renderEwidencjaPdf,
  renderNadgodzinyPdf,
  renderKeduPdf,
  buildEwidencjaPdfContent,
  buildNadgodzinyPdfContent,
  buildKeduPdfContent,
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

describe('pdf.renderer — pure content builders (testable without parsing PDF binary)', () => {
  it('buildEwidencjaPdfContent: zawiera nagłówek 4Mobility/HRobot, tabelę dni/godzin i znak wodny DEMO', () => {
    const content = buildEwidencjaPdfContent(employee, period, rows)
    const joined = content.lines.join('\n')
    expect(joined).toMatch(/4Mobility/)
    expect(joined).toMatch(/HRobot/)
    expect(joined).toContain('Kowalska')
    expect(joined).toContain('2026-06-08')
    expect(content.lines.some((l) => l.includes('480'))).toBe(true)
    expect(content.watermark).toBe(WATERMARK_TEXT)
  })

  it('buildNadgodzinyPdfContent: zawiera podsumowanie nadgodzin i znak wodny DEMO', () => {
    const content = buildNadgodzinyPdfContent(employee, period, summary)
    const joined = content.lines.join('\n')
    expect(joined).toMatch(/4Mobility/)
    expect(joined).toContain('120')
    expect(joined).toContain('60')
    expect(content.watermark).toBe(WATERMARK_TEXT)
  })

  it('buildKeduPdfContent: zawiera bloki DRA/RCA i znak wodny DEMO', () => {
    const content = buildKeduPdfContent(keduModel)
    const joined = content.lines.join('\n')
    expect(joined).toMatch(/DRA/)
    expect(joined).toMatch(/RCA/)
    expect(joined).toContain('90010112345')
    expect(content.watermark).toBe(WATERMARK_TEXT)
  })

  it('znak wodny to dokładnie tekst wymagany przez SPEC §0', () => {
    expect(WATERMARK_TEXT).toBe('WERSJA DEMO — dane syntetyczne — nie do obrotu prawnego / nie do wysyłki ZUS')
  })
})

describe('pdf.renderer — Buffer output (pdfkit)', () => {
  it('renderEwidencjaPdf zwraca niepusty Buffer zaczynający się od nagłówka %PDF', async () => {
    const buf = await renderEwidencjaPdf(employee, period, rows)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('renderNadgodzinyPdf zwraca niepusty Buffer zaczynający się od nagłówka %PDF', async () => {
    const buf = await renderNadgodzinyPdf(employee, period, summary)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('renderKeduPdf zwraca niepusty Buffer zaczynający się od nagłówka %PDF', async () => {
    const buf = await renderKeduPdf(keduModel)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
