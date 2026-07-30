/**
 * `dokumenty` PDF renderer — PURE of Prisma/I/O (SPEC §4.1 / DOK-9). Consumes the already-computed
 * models from §3 (ewidencja rows, overtime summary, KEDU model) and produces a PDF `Buffer`. This
 * module does NOT compute anything — it only formats what the engine already decided.
 *
 * PDF library decision (🔴 DECYZJA-4M in the spec, resolved here per the plan-phase gate): **pdfkit**
 * — a lightweight, pure-JS, MIT-licensed PDF generator with no native/system dependency (no headless
 * Chrome, no LibreOffice). Installed as a direct dependency of `@hrobot/tenant-runtime`
 * (`pdfkit` + `@types/pdfkit` dev). This is the demo-appropriate choice per SPEC §4.1/§11 gate #10 —
 * no heavyweight dependency was added.
 *
 * Testability: the actual byte layout of a PDF is not meaningfully assertable in a unit test (it's a
 * binary format with compressed streams). So the CONTENT — header, table rows, summary, and the
 * mandatory watermark — is built by pure, plain-string helper functions (`build*PdfContent`) that are
 * fully unit-testable. The `render*Pdf` functions feed that same content into pdfkit to produce bytes;
 * their tests only assert "valid non-empty PDF" (`%PDF-` magic bytes), since the content itself is
 * already covered by the pure builders.
 *
 * Watermark (SPEC §0 / DOK-9, non-negotiable): every PDF carries the VISIBLE legal-safety watermark
 * {@link WATERMARK_TEXT}, both as a large diagonal overlay and as plain body text (belt-and-braces —
 * a page description language does not need to be parsed to find it as a text run).
 */

import PDFDocument from 'pdfkit'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { EwidencjaRow, Period } from '../rcp.util'
import type { OvertimeSummary } from '../overtime.util'
import type { KeduModel } from '../kedu.util'

// =================================================================================================
// Shared constants / types
// =================================================================================================

/** Mandatory legal-safety watermark text (SPEC §0). Every rendered document must carry this. */
export const WATERMARK_TEXT = 'WERSJA DEMO — dane syntetyczne — nie do obrotu prawnego / nie do wysyłki ZUS'

/** Header line shared by every demo document (SPEC §4.1 — "nagłówek 4Mobility/HRobot"). */
const HEADER_LINE = '4Mobility / HRobot — dokument demonstracyjny (WERSJA POGLĄDOWA)'

/** Embedded Unicode font (Noto Sans, OFL-1.1) so Polish diacritics (ł/ą/ę/ś/ż/ó/ć/ń/ź) render
 * correctly — pdfkit's built-in Helvetica/Courier are WinAnsi-only and mangle PL glyphs (F1 fix).
 * Shipped next to this module (`fonts/`) and copied into `dist` via nest-cli `assets`; if the file
 * is somehow absent at runtime we fall back to Helvetica (renders, but garbles diacritics). */
const FONT_PATH = join(__dirname, 'fonts', 'NotoSans-Regular.ttf')
const HAS_UNICODE_FONT = existsSync(FONT_PATH)

/** Register the embedded Unicode font on `doc` and return the font name to use for ALL text. */
function useUnicodeFont(doc: InstanceType<typeof PDFDocument>): string {
  if (!HAS_UNICODE_FONT) return 'Helvetica'
  doc.registerFont('noto', FONT_PATH)
  return 'noto'
}

export type PdfEmployeeHeader = {
  employeeId: string
  imie: string
  nazwisko: string
}

/** Pure textual content for a rendered PDF — header, body lines, and the watermark. Testable without touching pdfkit. */
export type PdfContent = {
  title: string
  lines: string[]
  watermark: string
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
const fmtHM = (min: number | null): string => {
  if (min === null) return 'brak danych'
  const sign = min < 0 ? '-' : ''
  const abs = Math.abs(min)
  return `${min}min (${sign}${Math.floor(abs / 60)}h ${abs % 60}min)`
}

// =================================================================================================
// buildEwidencjaPdfContent
// =================================================================================================

/**
 * Pure content builder for the ewidencja (time record) PDF — table of days/hours per SPEC §4.1.
 * `absence`/`anomalie` surface the DOK-3 null-policy (`brak danych` is never shown as `0h`).
 */
export function buildEwidencjaPdfContent(employee: PdfEmployeeHeader, period: Period, rows: EwidencjaRow[]): PdfContent {
  const lines: string[] = [
    HEADER_LINE,
    `Ewidencja czasu pracy — ${employee.imie} ${employee.nazwisko} (ID: ${employee.employeeId})`,
    `Okres: ${fmtDate(period.start)} — ${fmtDate(period.end)}`,
    '',
    'Data       | Przepracowano | Przerwy | Absencja           | Uwagi',
    '-----------+---------------+---------+--------------------+------------------------',
  ]
  for (const r of rows) {
    const worked = fmtHM(r.workedMinutes)
    const breaks = `${r.breakMinutes}min`
    const absence = r.absence ?? '—'
    const uwagi = r.anomalie.length > 0 ? r.anomalie.join(', ') : '—'
    lines.push(`${r.date} | ${worked.padEnd(13)} | ${breaks.padEnd(7)} | ${absence.padEnd(18)} | ${uwagi}`)
  }
  lines.push('', WATERMARK_TEXT)
  return { title: 'Ewidencja czasu pracy (DEMO)', lines, watermark: WATERMARK_TEXT }
}

// =================================================================================================
// buildNadgodzinyPdfContent
// =================================================================================================

/** Pure content builder for the overtime-summary PDF — SPEC §4.1 "podsumowanie". */
export function buildNadgodzinyPdfContent(employee: PdfEmployeeHeader, period: Period, summary: OvertimeSummary): PdfContent {
  const lines: string[] = [
    HEADER_LINE,
    `Podsumowanie nadgodzin — ${employee.imie} ${employee.nazwisko} (ID: ${employee.employeeId})`,
    `Okres: ${fmtDate(period.start)} — ${fmtDate(period.end)}`,
    '',
    `Nadgodziny dobowe (50%): ${summary.ot50Min} min`,
    `Nadgodziny średniotygodniowe (100%): ${summary.ot100Min} min`,
    `w tym nocne: ${summary.nightMin} min`,
    `w tym niedzielne: ${summary.sundayMin} min`,
    `w tym świąteczne: ${summary.holidayMin} min`,
    `Unia nocne/niedziela/święto (100%, liczone raz): ${summary.ot100NightSundayHolidayMin} min`,
    `Dni z nadgodzinami: ${summary.count}`,
    `Dni bez danych RCP (brak odczytu): ${summary.daysWithoutRcp}`,
  ]
  if (summary.annualLimitWarning) {
    lines.push(
      `⚠ OSTRZEŻENIE: przewidywane roczne nadgodziny (${summary.annualLimitWarning.projectedMin} min) przekraczają limit ${summary.annualLimitWarning.limitMin} min (art. 151 §3 KP, poglądowo) — TYLKO ostrzeżenie, decyzja należy do kadr.`,
    )
  }
  lines.push('', WATERMARK_TEXT)
  return { title: 'Podsumowanie nadgodzin (DEMO)', lines, watermark: WATERMARK_TEXT }
}

// =================================================================================================
// buildKeduPdfContent
// =================================================================================================

/** Pure content builder for a human-readable PDF rendering of the KEDU model — SPEC §4.1 / §4.2. */
export function buildKeduPdfContent(model: KeduModel): PdfContent {
  const lines: string[] = [
    HEADER_LINE,
    `Deklaracja KEDU (szkielet strukturalny) — ${model.wersjaSchematu}`,
    '',
    'DRA — deklaracja rozliczeniowa',
    `  Płatnik NIP: ${model.dra.platnikNip}`,
    `  Płatnik: ${model.dra.platnikNazwa}`,
    `  Kod terminu: ${model.dra.kodTerminu}`,
    `  Okres: ${model.dra.okresOd} — ${model.dra.okresDo}`,
    `  Liczba ubezpieczonych: ${model.dra.liczbaUbezpieczonych}`,
    '',
    'RCA — imienny raport miesięczny',
  ]
  for (const r of model.rca) {
    lines.push(
      `  ${r.imie} ${r.nazwisko} (PESEL: ${r.pesel}) — przepracowano: ${r.workedMinutes} min, nadgodziny 50%: ${r.ot50Min} min, nadgodziny 100%: ${r.ot100Min} min`,
    )
  }
  lines.push('', 'RSA — raport o przerwach')
  if (model.rsa.length === 0) {
    lines.push('  (brak absencji w okresie)')
  } else {
    for (const r of model.rsa) {
      lines.push(`  PESEL: ${r.pesel} — kod ${r.kod} (${r.category}) — od ${r.od} do ${r.do}`)
    }
  }
  lines.push('', WATERMARK_TEXT)
  return { title: 'Deklaracja KEDU (DEMO)', lines, watermark: WATERMARK_TEXT }
}

// =================================================================================================
// pdfkit rendering (bytes)
// =================================================================================================

/** Render a {@link PdfContent} into PDF bytes via pdfkit: header, body lines, and a visible diagonal watermark overlay. */
function renderContentToPdfBuffer(content: PdfContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', (err: Error) => reject(err))

    const font = useUnicodeFont(doc)
    doc.font(font).fontSize(16).text(content.title, { align: 'center' })
    doc.moveDown()
    doc.font(font).fontSize(9)
    for (const line of content.lines) {
      doc.text(line)
    }

    // Visible diagonal watermark overlay (belt-and-braces alongside the plain-text watermark line
    // already appended to `content.lines` — SPEC §0 / DOK-9).
    doc.save()
    doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] })
    doc.font(font).fontSize(28).fillColor('red').opacity(0.35)
    doc.text(content.watermark, 0, doc.page.height / 2 - 40, { align: 'center', width: doc.page.width })
    doc.opacity(1).fillColor('black')
    doc.restore()

    doc.end()
  })
}

/** Render the ewidencja (time-record) PDF for one employee/period. SPEC §4.1. */
export function renderEwidencjaPdf(employee: PdfEmployeeHeader, period: Period, rows: EwidencjaRow[]): Promise<Buffer> {
  return renderContentToPdfBuffer(buildEwidencjaPdfContent(employee, period, rows))
}

/** Render the overtime-summary PDF for one employee/period. SPEC §4.1. */
export function renderNadgodzinyPdf(employee: PdfEmployeeHeader, period: Period, summary: OvertimeSummary): Promise<Buffer> {
  return renderContentToPdfBuffer(buildNadgodzinyPdfContent(employee, period, summary))
}

/** Render a human-readable PDF rendering of the KEDU model. SPEC §4.1 / §4.2. */
export function renderKeduPdf(model: KeduModel): Promise<Buffer> {
  return renderContentToPdfBuffer(buildKeduPdfContent(model))
}

/**
 * Render several {@link PdfContent} sections into ONE PDF (one page per section), each carrying the
 * mandatory diagonal watermark. Used by the service to produce a single-document PDF for a multi-
 * employee scope (UNIT/ALL ewidencja/nadgodziny) while reusing the same pure content builders — the
 * single-employee case is just an array of one. SPEC §4.1 / DOK-9.
 */
export function renderReportPdf(contents: PdfContent[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', (err: Error) => reject(err))

    const font = useUnicodeFont(doc)
    const sections = contents.length > 0 ? contents : [{ title: 'Dokument (DEMO)', lines: [WATERMARK_TEXT], watermark: WATERMARK_TEXT }]
    sections.forEach((content, i) => {
      if (i > 0) doc.addPage()
      doc.font(font).fontSize(16).text(content.title, { align: 'center' })
      doc.moveDown()
      doc.font(font).fontSize(9)
      for (const line of content.lines) doc.text(line)

      doc.save()
      doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] })
      doc.font(font).fontSize(28).fillColor('red').opacity(0.35)
      doc.text(content.watermark, 0, doc.page.height / 2 - 40, { align: 'center', width: doc.page.width })
      doc.opacity(1).fillColor('black')
      doc.restore()
    })

    doc.end()
  })
}
