/**
 * `dokumenty` PDF renderer — PURE of Prisma/I/O (SPEC §4.1 / DOK-9). Consumes the already-computed
 * models from §3 (ewidencja rows, overtime summary, KEDU model) and produces a PDF `Buffer`. This
 * module does NOT compute anything — it only formats what the engine already decided.
 *
 * ── Rewrite note (tor DOK, 2026-08-04) ──────────────────────────────────────────────────────────
 * The previous implementation used `pdfkit`, hand-formatting table rows as `|`-joined plain-text
 * strings. That produced a document that reads like a terminal dump: no real table markup, no
 * repeating header on page breaks, rows silently cut across page boundaries, no page numbering, and
 * (per user report) two overlapping diagonal watermarks. Root cause of the plain-text look: pdfkit
 * has no table/layout engine, so every visual structure had to be hand-simulated with padded
 * strings and `|` characters.
 *
 * This version instead builds a real HTML document (proper `<table><thead>…`, CSS) and prints it to
 * PDF via the Chrome DevTools Protocol (`Page.printToPDF`) — the exact mechanism already proven in
 * `docs/raport-km3/build/print-km3.mjs` (used to produce the PARP-submitted KM3 report), adapted for
 * a backend service instead of a one-off build script:
 *   1. Chromium executable path comes from `HROBOT_CHROMIUM_PATH`/`PUPPETEER_EXECUTABLE_PATH` or a
 *      platform-appropriate search list, instead of the hardcoded Windows `chrome.exe` path in the
 *      reference script — the container image (`apps/tenant-runtime/Dockerfile`) installs Chromium
 *      at a fixed Linux path and sets that env var.
 *   2. `--disable-dev-shm-usage` added — containers often have a tiny `/dev/shm`, which crashes
 *      Chromium's shared-memory renderer under load; harmless on a normal dev machine.
 *   3. Temp `--user-data-dir`/HTML file live under `os.tmpdir()` (cross-platform) instead of the
 *      Windows-only `%TEMP%` env var, and are always cleaned up in a `finally` block.
 *
 * Determinism (acceptance criterion: two renders of the same content = identical bytes): verified
 * empirically (see track-dok.md log) that content-identical renders differ ONLY in the PDF `/Info`
 * dictionary's `/CreationDate`/`/ModDate` (Chrome stamps wall-clock time there); no other byte
 * differs, including no random `/ID` trailer entries in this Chrome version's output. Both fields
 * are normalized to a fixed placeholder post-render, in place, byte-length-preserving (so no PDF
 * xref offset is invalidated) — see {@link normalizePdfDeterminism}.
 *
 * Fonts: DESIGN.md §4 specifies Cabinet Grotesk/General Sans (Fontshare/ITF). Their license terms
 * for embedding inside a DISTRIBUTED PDF (a different licensing field than CSS `@font-face` on a
 * website) could not be verified here — see `render/fonts/fonts.ts` header and
 * `data/m2-evidence/licenses/forma-dokumentow-fonts.md`. Substituted with OFL-1.1 fonts of similar
 * character (Archivo, Public Sans); IBM Plex Mono unchanged (already OFL-1.1). All embedded as
 * base64 `data:` URIs — zero network requests at render time (acceptance criterion).
 *
 * Testability: `buildXPdfContent` (pure, structured — no `|` string-formatting) and
 * `renderContentsToHtml` (pure HTML-string builder) are unit-testable without a browser. Only the
 * final HTML→PDF step needs a real Chromium process; that path is covered by
 * `pdf.renderer.chrome.integration.spec.ts` (integration lane — matches the existing convention
 * of keeping the unit lane hermetic, see `jest.config.cjs`).
 *
 * Watermark (SPEC §0 / DOK-9, non-negotiable): every PDF carries the VISIBLE legal-safety watermark
 * {@link WATERMARK_TEXT}. Exactly ONE watermark element exists in the generated HTML (a single
 * `position: fixed` layer) — Chrome's print engine repeats a fixed-position element identically on
 * every physical page of a multi-page PDF (verified empirically, see track-dok.md), so a single
 * source element yields full per-page coverage with no risk of two overlapping instances at
 * different angles (the bug this rewrite fixes).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EwidencjaRow, Period } from '../rcp.util'
import type { OvertimeSummary } from '../overtime.util'
import type { KeduModel } from '../kedu.util'
import { EMBEDDED_FONT_FACES_CSS, FONT_FAMILY_BODY, FONT_FAMILY_DISPLAY, FONT_FAMILY_MONO } from './fonts/fonts'

// =================================================================================================
// Shared constants / types
// =================================================================================================

/** Mandatory legal-safety watermark text (SPEC §0). Every rendered document must carry this. */
export const WATERMARK_TEXT = 'WERSJA DEMO — dane syntetyczne — nie do obrotu prawnego / nie do wysyłki ZUS'

/** Brand line shown on every physical page via the CDP header template (SPEC §4.1). */
const HEADER_LINE = '4Mobility / HRobot — dokument demonstracyjny (WERSJA POGLĄDOWA)'

export type PdfEmployeeHeader = {
  employeeId: string
  imie: string
  nazwisko: string
}

/** One label/value line in a document's meta block (employee, period, schema version, …). */
export type PdfMetaLine = { label: string; value: string }

/** One table column — `mono` routes the cell through the IBM-Plex-Mono machine layer (SPEC §4.1
 * "warstwa maszynowa"): IDs, PESEL, dates. `align: 'right'` is used for numeric/duration columns. */
export type PdfTableColumn = { key: string; header: string; align?: 'left' | 'right'; mono?: boolean }
export type PdfTableRow = Record<string, string>
export type PdfTable = { columns: PdfTableColumn[]; rows: PdfTableRow[] }

/**
 * Pure, structured content for a rendered PDF section — NO pre-formatted `|`-joined strings
 * anywhere (acceptance criterion: zero `|` characters used as layout). One `PdfContent` = one page
 * (or page group) in the final PDF; `renderReportPdf` concatenates several into one document.
 */
export type PdfContent = {
  title: string
  meta: PdfMetaLine[]
  tables?: { heading?: string; table: PdfTable }[]
  notes?: { text: string; tone?: 'default' | 'warn' }[]
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
  const table: PdfTable = {
    columns: [
      { key: 'date', header: 'Data', mono: true },
      { key: 'worked', header: 'Przepracowano', align: 'right' },
      { key: 'breaks', header: 'Przerwy', align: 'right' },
      { key: 'absence', header: 'Absencja' },
      { key: 'uwagi', header: 'Uwagi' },
    ],
    rows: rows.map((r) => ({
      date: r.date,
      worked: fmtHM(r.workedMinutes),
      breaks: `${r.breakMinutes}min`,
      absence: r.absence ?? '—',
      uwagi: r.anomalie.length > 0 ? r.anomalie.join(', ') : '—',
    })),
  }
  return {
    title: 'Ewidencja czasu pracy (DEMO)',
    meta: [
      { label: 'Pracownik', value: `${employee.imie} ${employee.nazwisko} (ID: ${employee.employeeId})` },
      { label: 'Okres', value: `${fmtDate(period.start)} — ${fmtDate(period.end)}` },
    ],
    tables: [{ table }],
    watermark: WATERMARK_TEXT,
  }
}

// =================================================================================================
// buildNadgodzinyPdfContent
// =================================================================================================

/** Pure content builder for the overtime-summary PDF — SPEC §4.1 "podsumowanie". */
export function buildNadgodzinyPdfContent(employee: PdfEmployeeHeader, period: Period, summary: OvertimeSummary): PdfContent {
  const table: PdfTable = {
    columns: [
      { key: 'metric', header: 'Metryka' },
      { key: 'value', header: 'Wartość', align: 'right', mono: true },
    ],
    rows: [
      { metric: 'Nadgodziny dobowe (50%)', value: `${summary.ot50Min} min` },
      { metric: 'Nadgodziny średniotygodniowe (100%)', value: `${summary.ot100Min} min` },
      { metric: 'w tym nocne', value: `${summary.nightMin} min` },
      { metric: 'w tym niedzielne', value: `${summary.sundayMin} min` },
      { metric: 'w tym świąteczne', value: `${summary.holidayMin} min` },
      { metric: 'Unia nocne/niedziela/święto (100%, liczone raz)', value: `${summary.ot100NightSundayHolidayMin} min` },
      { metric: 'Dni z nadgodzinami', value: `${summary.count}` },
      { metric: 'Dni bez danych RCP (brak odczytu)', value: `${summary.daysWithoutRcp}` },
    ],
  }
  const notes: PdfContent['notes'] = []
  if (summary.annualLimitWarning) {
    notes.push({
      tone: 'warn',
      text: `⚠ OSTRZEŻENIE: przewidywane roczne nadgodziny (${summary.annualLimitWarning.projectedMin} min) przekraczają limit ${summary.annualLimitWarning.limitMin} min (art. 151 §3 KP, poglądowo) — TYLKO ostrzeżenie, decyzja należy do kadr.`,
    })
  }
  return {
    title: 'Podsumowanie nadgodzin (DEMO)',
    meta: [
      { label: 'Pracownik', value: `${employee.imie} ${employee.nazwisko} (ID: ${employee.employeeId})` },
      { label: 'Okres', value: `${fmtDate(period.start)} — ${fmtDate(period.end)}` },
    ],
    tables: [{ table }],
    notes,
    watermark: WATERMARK_TEXT,
  }
}

// =================================================================================================
// buildKeduPdfContent
// =================================================================================================

/** Pure content builder for a human-readable PDF rendering of the KEDU model — SPEC §4.1 / §4.2. */
export function buildKeduPdfContent(model: KeduModel): PdfContent {
  const rcaTable: PdfTable = {
    columns: [
      { key: 'imie', header: 'Imię' },
      { key: 'nazwisko', header: 'Nazwisko' },
      { key: 'pesel', header: 'PESEL', mono: true },
      { key: 'worked', header: 'Przepracowano', align: 'right' },
      { key: 'ot50', header: 'Nadgodziny 50%', align: 'right' },
      { key: 'ot100', header: 'Nadgodziny 100%', align: 'right' },
    ],
    rows: model.rca.map((r) => ({
      imie: r.imie,
      nazwisko: r.nazwisko,
      pesel: r.pesel,
      worked: `${r.workedMinutes} min`,
      ot50: `${r.ot50Min} min`,
      ot100: `${r.ot100Min} min`,
    })),
  }
  const rsaTable: PdfTable = {
    columns: [
      { key: 'pesel', header: 'PESEL', mono: true },
      { key: 'kod', header: 'Kod', mono: true },
      { key: 'category', header: 'Kategoria' },
      { key: 'od', header: 'Od', mono: true },
      { key: 'do', header: 'Do', mono: true },
    ],
    rows: model.rsa.map((r) => ({ pesel: r.pesel, kod: r.kod, category: r.category, od: r.od, do: r.do })),
  }
  return {
    title: 'Deklaracja KEDU (DEMO)',
    meta: [
      { label: 'Wersja schematu', value: model.wersjaSchematu },
      { label: 'Płatnik NIP', value: model.dra.platnikNip },
      { label: 'Płatnik', value: model.dra.platnikNazwa },
      { label: 'Kod terminu', value: model.dra.kodTerminu },
      { label: 'Okres', value: `${model.dra.okresOd} — ${model.dra.okresDo}` },
      { label: 'Liczba ubezpieczonych', value: `${model.dra.liczbaUbezpieczonych}` },
    ],
    tables: [
      { heading: 'RCA — imienny raport miesięczny', table: rcaTable },
      { heading: 'RSA — raport o przerwach', table: rsaTable },
    ],
    notes: model.rsa.length === 0 ? [{ text: '(brak absencji w okresie)' }] : [],
    watermark: WATERMARK_TEXT,
  }
}

// =================================================================================================
// Pure HTML builder — testable without a browser
// =================================================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTableHtml(table: PdfTable): string {
  const cellClass = (c: PdfTableColumn) => [c.align === 'right' ? 'num' : '', c.mono ? 'mono' : ''].filter(Boolean).join(' ')
  const thead = `<thead><tr>${table.columns
    .map((c) => `<th class="${cellClass(c)}">${escapeHtml(c.header)}</th>`)
    .join('')}</tr></thead>`
  const tbody = `<tbody>${table.rows
    .map(
      (row) =>
        `<tr>${table.columns.map((c) => `<td class="${cellClass(c)}">${escapeHtml(row[c.key] ?? '')}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody>`
  return `<table class="doc-table">${thead}${tbody}</table>`
}

function renderSectionHtml(content: PdfContent, isFirst: boolean): string {
  const metaHtml = content.meta
    .map((m) => `<div class="meta-row"><span class="meta-label">${escapeHtml(m.label)}</span><span class="meta-value">${escapeHtml(m.value)}</span></div>`)
    .join('')
  const tablesHtml = (content.tables ?? [])
    .map((t) => `${t.heading ? `<h2 class="table-heading">${escapeHtml(t.heading)}</h2>` : ''}${renderTableHtml(t.table)}`)
    .join('')
  const notesHtml = (content.notes ?? []).length
    ? `<div class="notes">${(content.notes ?? []).map((n) => `<p class="${n.tone === 'warn' ? 'warn' : ''}">${escapeHtml(n.text)}</p>`).join('')}</div>`
    : ''
  return `<section class="doc-section${isFirst ? '' : ' page-break'}">
  <h1 class="doc-title">${escapeHtml(content.title)}</h1>
  <div class="doc-meta">${metaHtml}</div>
  ${tablesHtml}
  ${notesHtml}
</section>`
}

/** Base CSS shared by every generated document — tokens taken from `DESIGN.md` §5/§6/§10 (colors,
 * spacing, table component spec: "mono uppercase headers, hairline rows, tabular-nums"). */
const BASE_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: ${FONT_FAMILY_BODY};
  font-size: 10pt;
  line-height: 1.4;
  color: #101A2B;
  background: #FFFFFF;
}
.watermark {
  position: fixed;
  top: 50%;
  left: 0;
  width: 100%;
  text-align: center;
  transform: translateY(-50%) rotate(-45deg);
  font-family: ${FONT_FAMILY_DISPLAY};
  font-weight: 800;
  font-size: 30pt;
  color: #C2443B;
  opacity: 0.16;
  z-index: 9999;
  pointer-events: none;
}
.doc-section.page-break { break-before: page; page-break-before: always; }
.doc-title {
  font-family: ${FONT_FAMILY_DISPLAY};
  font-weight: 700;
  font-size: 17pt;
  letter-spacing: -.02em;
  color: #0B1F3B;
  margin: 0 0 10px 0;
}
.doc-meta { margin-bottom: 12px; }
.meta-row { display: flex; gap: 8px; font-size: 9.5pt; padding: 1.5px 0; }
.meta-label { color: #5B6B82; min-width: 150px; font-weight: 600; }
.meta-value { color: #101A2B; }
.table-heading {
  font-family: ${FONT_FAMILY_DISPLAY};
  font-weight: 700;
  font-size: 12pt;
  color: #0B1F3B;
  margin: 14px 0 6px 0;
}
table.doc-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
table.doc-table thead { display: table-header-group; }
table.doc-table th {
  font-family: ${FONT_FAMILY_MONO};
  text-transform: uppercase;
  letter-spacing: .06em;
  font-size: 7.5pt;
  text-align: left;
  color: #5B6B82;
  background: #FBFAF6;
  border-bottom: 1px solid #D9D5C8;
  padding: 5px 7px;
}
table.doc-table td {
  font-size: 9pt;
  padding: 4.5px 7px;
  border-bottom: 1px solid #E7E4DA;
}
table.doc-table tr { break-inside: avoid; page-break-inside: avoid; }
table.doc-table td.num, table.doc-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
table.doc-table td.mono, table.doc-table th.mono { font-family: ${FONT_FAMILY_MONO}; }
.notes p { font-size: 9.5pt; margin: 4px 0; }
.notes p.warn { color: #B8791F; font-weight: 600; }
`.trim()

/**
 * Pure HTML document builder — no browser needed to call/test this. One or more `PdfContent`
 * sections become one HTML document; page 2+ sections get `break-before: page`. Exactly one
 * watermark element is emitted (see module doc comment for why that's sufficient for every page).
 */
export function renderContentsToHtml(contents: PdfContent[]): string {
  const sections: PdfContent[] = contents.length > 0 ? contents : [{ title: 'Dokument (DEMO)', meta: [], watermark: WATERMARK_TEXT }]
  const firstSection = sections[0]!
  const watermarkText = firstSection.watermark
  const body = sections.map((c, i) => renderSectionHtml(c, i === 0)).join('\n')
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(firstSection.title)}</title>
<style>
${EMBEDDED_FONT_FACES_CSS}
${BASE_CSS}
</style>
</head>
<body>
<div class="watermark">${escapeHtml(watermarkText)}</div>
${body}
</body>
</html>`
}

const HEADER_TEMPLATE = `<div style="width:100%;font-size:7.5px;color:#5B6B82;padding:0 12mm;font-family:Arial,sans-serif;">${escapeHtml(HEADER_LINE)}</div>`
const FOOTER_TEMPLATE = `<div style="width:100%;font-size:7.5px;color:#5B6B82;text-align:center;padding:0 12mm;font-family:Arial,sans-serif;">Strona <span class="pageNumber"></span> z <span class="totalPages"></span></div>`

// =================================================================================================
// Determinism normalization
// =================================================================================================

/**
 * Normalize the ONLY source of byte-nondeterminism found empirically between two renders of
 * identical content: Chrome stamps the current wall-clock time into `/CreationDate`/`/ModDate` in
 * the PDF `/Info` dictionary. Replaced in place with a fixed placeholder, preserving the exact
 * matched length (the `\d{14}` digit run is always 14 chars; the timezone suffix is kept as-is) so
 * no PDF xref byte-offset is invalidated.
 */
export function normalizePdfDeterminism(buf: Buffer): Buffer {
  const text = buf.toString('latin1')
  const normalized = text.replace(/D:\d{14}([+\-]\d{2}'\d{2}')/g, (_m, tz: string) => `D:20000101000000${tz}`)
  return Buffer.from(normalized, 'latin1')
}

// =================================================================================================
// Chrome DevTools Protocol print engine
// =================================================================================================

function resolveChromiumExecutable(): string {
  const envPath = process.env.HROBOT_CHROMIUM_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH
  if (envPath && existsSync(envPath)) return envPath
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : [
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
        ]
  for (const c of candidates) if (existsSync(c)) return c
  throw new Error(
    'Nie znaleziono binarki Chromium/Chrome do renderowania PDF. Ustaw HROBOT_CHROMIUM_PATH (kontener: ' +
      'apps/tenant-runtime/Dockerfile instaluje chromium pod stałą ścieżką i eksportuje tę zmienną).',
  )
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      if (address && typeof address === 'object') {
        const { port } = address
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('getFreePort: brak adresu')))
      }
    })
  })
}

/** GET the DevTools `/json` page list from our own just-spawned, loopback-only Chrome instance.
 * Deliberately built on `node:http` rather than a generic browser-style HTTP client — this module
 * is bound by DOK-10 (see `dokumenty-no-send.spec.ts`) to never perform an outbound network call,
 * and while this request never leaves the machine (127.0.0.1, a child process we spawned ourselves
 * — nothing external, nothing that could carry PESEL/employee data anywhere), staying off the
 * usual outbound-HTTP call shapes keeps that guard's blanket bans meaningful and simple to audit. */
function getLoopbackJson<T>(port: number, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = httpGet({ host: '127.0.0.1', port, path, timeout: 2_000 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
  })
}

async function waitForDevtoolsPageWs(port: number, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await getLoopbackJson<Array<{ type: string; webSocketDebuggerUrl?: string }>>(port, '/json')
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Chrome not listening yet — retry.
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('Chrome DevTools endpoint nie odpowiedział w czasie ' + timeoutMs + 'ms')
}

let rpcIdCounter = 0
function cdpRpc<T = unknown>(ws: WebSocket, method: string, params: Record<string, unknown>): Promise<T> {
  const id = ++rpcIdCounter
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data as string) as { id?: number; result?: T; error?: { message: string } }
      if (msg.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (msg.error) reject(new Error(`CDP ${method} failed: ${msg.error.message}`))
      else resolve(msg.result as T)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/** Wait for a CDP event (no `id` field, unlike RPC responses) by method name, bounded by a timeout
 * so a page that never fires it (shouldn't happen for a local `file://` load) can't hang forever. */
function cdpWaitForEvent(ws: WebSocket, eventMethod: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      ws.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve()
    }
    const onMessage = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data as string) as { method?: string }
      if (msg.method === eventMethod) settle()
    }
    ws.addEventListener('message', onMessage)
    const timer = setTimeout(settle, timeoutMs)
  })
}

/**
 * Render an HTML document to PDF bytes via headless Chrome + `Page.printToPDF`. Margins match the
 * proven `docs/raport-km3/build/print-km3.mjs` pipeline (0.72/0.55/0.63/0.63in). Zero network
 * requests: the page is loaded from a local `file://` URL and every asset (fonts) is inlined as a
 * `data:` URI — nothing is fetched over HTTP(S).
 */
async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const executablePath = resolveChromiumExecutable()
  const workDir = mkdtempSync(join(tmpdir(), 'hrobot-dok-pdf-'))
  const htmlPath = join(workDir, 'document.html')
  writeFileSync(htmlPath, html, 'utf8')
  const userDataDir = join(workDir, 'chrome-profile')
  const port = await getFreePort()
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/')

  let chrome: ChildProcessWithoutNullStreams | undefined
  let ws: WebSocket | undefined
  try {
    chrome = spawn(
      executablePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--hide-scrollbars',
        '--disable-application-cache',
        '--disk-cache-size=1',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        // Launch on a blank page — NOT the target file. Navigating from the command line races
        // Chrome's own page load against our CDP connection/`Page.enable` setup below (found
        // empirically to cause intermittent determinism failures: `Page.loadEventFired` firing
        // before we subscribed meant the font-readiness wait sometimes resolved against an
        // unlaid-out document, letting fallback-font metrics leak into the print on a coin-flip).
        // `Page.navigate` is called explicitly below, AFTER event listeners are attached, so the
        // load event is guaranteed to be observed every time.
        'about:blank',
      ],
      { stdio: 'ignore' },
    ) as ChildProcessWithoutNullStreams

    const wsUrl = await waitForDevtoolsPageWs(port)
    ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      ws!.addEventListener('open', () => resolve())
      ws!.addEventListener('error', () => reject(new Error('Nie udało się otworzyć połączenia CDP WebSocket')))
    })

    await cdpRpc(ws, 'Page.enable', {})
    const loadEventFired = cdpWaitForEvent(ws, 'Page.loadEventFired', 15_000)
    await cdpRpc(ws, 'Page.navigate', { url: fileUrl })
    await loadEventFired
    // Wait for embedded @font-face fonts to finish parsing/loading before printing — otherwise the
    // print can race a font swap, which would also threaten the byte-determinism guarantee. Safe to
    // rely on `document.fonts.ready` now: the load event above guarantees the DOM/CSSOM (and thus
    // every `@font-face` declaration) is already parsed before this runs.
    await cdpRpc(ws, 'Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })

    const result = await cdpRpc<{ data: string }>(ws, 'Page.printToPDF', {
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.72,
      marginBottom: 0.55,
      marginLeft: 0.63,
      marginRight: 0.63,
      preferCSSPageSize: false,
      // Tagged-PDF (accessibility structure tree) assigns internal `/StructElem` `/ID (nodeNNNNN)`
      // counters that were found EMPIRICALLY to differ between two content-identical renders (see
      // track-dok.md) — the only other nondeterminism source besides CreationDate/ModDate, and NOT
      // fixable with a length-preserving byte patch (the tree size/shape isn't fixed). Determinism
      // is an explicit, testable acceptance criterion; tagging is disabled to guarantee it.
      generateTaggedPDF: false,
    })

    return normalizePdfDeterminism(Buffer.from(result.data, 'base64'))
  } finally {
    ws?.close()
    if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
      const exited = new Promise<void>((resolve) => chrome!.once('exit', () => resolve()))
      chrome.kill()
      // Windows holds file locks on the profile dir briefly after SIGTERM until the process fully
      // unwinds; wait for the actual exit event (bounded) before touching the directory. Always
      // clear the fallback timer so it can't keep the event loop alive after `exited` wins.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3_000)
        exited.then(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    // `maxRetries`/`retryDelay`: Windows can keep a transient lock on files (AV scan, delayed
    // handle release) even after the owning process has exited — Node's documented mitigation.
    //
    // BEST-EFFORT, AND THAT IS THE POINT. This runs in `finally`, so anything thrown here REPLACES
    // the successful return and destroys an already-rendered PDF. That is not hypothetical: CI on
    // ubuntu-latest failed with `ENOTEMPTY: rmdir '<workDir>/chrome-profile/Default'` while the
    // document itself had rendered fine. Waiting for the parent's `exit` event is not enough on
    // Linux — Chrome's zygote/renderer children outlive it briefly and keep writing into the
    // profile directory, so files reappear between `rmSync`'s readdir and its rmdir.
    //
    // A leftover directory under the OS temp dir is housekeeping; a lost PDF is a failed document.
    // The temp dir is reclaimed by the OS regardless.
    try {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (err) {
      // console, not a Nest Logger: this module is deliberately framework-free (plain node builtins
      // only), so it stays usable from a CLI/script as well as from the service.
      console.warn(
        `pdf.renderer: nie udalo sie usunac katalogu roboczego Chrome (${workDir}); ` +
          `PDF wyrenderowany poprawnie. ${String(err)}`,
      )
    }
  }
}

// =================================================================================================
// Public render* API (contract preserved: model -> bytes)
// =================================================================================================

/** Render the ewidencja (time-record) PDF for one employee/period. SPEC §4.1. */
export function renderEwidencjaPdf(employee: PdfEmployeeHeader, period: Period, rows: EwidencjaRow[]): Promise<Buffer> {
  return renderHtmlToPdfBuffer(renderContentsToHtml([buildEwidencjaPdfContent(employee, period, rows)]))
}

/** Render the overtime-summary PDF for one employee/period. SPEC §4.1. */
export function renderNadgodzinyPdf(employee: PdfEmployeeHeader, period: Period, summary: OvertimeSummary): Promise<Buffer> {
  return renderHtmlToPdfBuffer(renderContentsToHtml([buildNadgodzinyPdfContent(employee, period, summary)]))
}

/** Render a human-readable PDF rendering of the KEDU model. SPEC §4.1 / §4.2. */
export function renderKeduPdf(model: KeduModel): Promise<Buffer> {
  return renderHtmlToPdfBuffer(renderContentsToHtml([buildKeduPdfContent(model)]))
}

/**
 * Render several {@link PdfContent} sections into ONE PDF (one page-group per section, each getting
 * `break-before: page` except the first), all sharing the single document-level watermark. Used by
 * the service to produce a single-document PDF for a multi-employee scope (UNIT/ALL ewidencja/
 * nadgodziny) while reusing the same pure content builders — the single-employee case is just an
 * array of one. SPEC §4.1 / DOK-9.
 */
export function renderReportPdf(contents: PdfContent[]): Promise<Buffer> {
  return renderHtmlToPdfBuffer(renderContentsToHtml(contents))
}
