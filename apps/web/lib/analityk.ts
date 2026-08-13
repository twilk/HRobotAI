/**
 * `analityk` (Analityk HR, M3) client model for the web-kit UAT surface.
 *
 * LIVE: `analitykApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js
 * proxy at `/api/analityk/*` (see app/api/analityk/[[...path]] + lib/tenant-runtime.ts), which
 * forwards to the NestJS `analityk` controller
 * (apps/tenant-runtime/src/analityk/analityk.controller.ts) with a cookie-resolved Keycloak bearer.
 *
 * Mirrors lib/strategic-brain.ts: a thin `anFetch` wrapper + an `AnalitykError` carrying the
 * upstream HTTP status, plus PURE formatters and chart-geometry calculators exported separately so
 * the components and the unit tests share exactly one source of truth. Nothing here recomputes an
 * aggregate — every figure arrives already computed (and already RBAC-scoped) from the backend, and
 * every payload is IDs + numbers only, never PII.
 */

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 502 (down). */
export class AnalitykError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AnalitykError'
  }
}

async function anFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new AnalitykError(res.status, humanizeError(detail) || res.statusText)
  }
  return (await res.json()) as T
}

/** Surface the backend's `message` (NestJS error body) rather than a raw JSON blob. */
function humanizeError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] }
    const msg = Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message
    if (msg) return msg
  } catch {
    /* fall through to the raw body */
  }
  return body
}

// --- API response types (mirror apps/tenant-runtime/src/analityk/analityk.service.ts) --------------

/** Echo of what a figure was computed over + the caveats that MUST be shown next to it. */
export interface AnalitykMeta {
  od: string
  do: string
  /** `null` = the whole tenant (a global HR/ADMIN caller); otherwise the units aggregated. */
  unitIds: string[] | null
  dniRobocze: number
  uwagi: string[]
}

export interface UnitBreakdown {
  unitId: string
  nazwa: string
  liczba: number
}

export interface ZatrudnienieResult {
  meta: AnalitykMeta
  stanNaKoniec: number
  stanNaPoczatek: number
  przyjecia: number
  /** `null` = UNKNOWN (no employee record is linked to a user account), never a reassuring 0. */
  odejscia: number | null
  zmiana: number | null
  /** Raw rate FOR THE SELECTED PERIOD — not annualized. Labelled as such everywhere it is rendered. */
  rotacjaWOkresie: number | null
  wgJednostek: UnitBreakdown[]
  wgLokalizacji: UnitBreakdown[]
  dynamika: { miesiac: string; przyjecia: number; odejscia: number | null }[]
}

export interface AbsencjeResult {
  meta: AnalitykMeta
  dniNieobecnosci: number
  dniRoboczeLacznie: number
  wskaznik: number | null
  wgTypu: { typ: string; dni: number; udzial: number | null }[]
  wgJednostek: { unitId: string; nazwa: string; dni: number; dniRobocze: number; wskaznik: number | null }[]
}

export interface CzasPracyResult {
  meta: AnalitykMeta
  sumaGodzin: number
  liczbaZmian: number
  osobodni: number
  sredniaDzienna: number | null
  normaGodzin: number
  /**
   * Rostered hours above the WEEKLY norm. NOT "nadgodziny" under the Kodeks pracy: planned time, no
   * unpaid-break deduction, no daily norm (art. 151 §1). Every label rendering it must say so.
   */
  nadwyzkaPonadNorme: number
  niedoborDoNormy: number
  wgJednostek: { unitId: string; nazwa: string; godziny: number; nadwyzka: number }[]
  topNadwyzka: { employeeId: string; unitId: string; nadwyzka: number }[]
}

export interface UrlopyResult {
  meta: AnalitykMeta
  rok: number
  wymiarDni: number
  liczbaPracownikow: number
  wykorzystaneDni: number
  wskaznikWykorzystania: number | null
  srednieSaldo: number | null
  rozkladSalda: { przedzial: string; liczba: number }[]
  ryzykoPrzepadniecia: { employeeId: string; unitId: string; saldo: number; wykorzystane: number }[]
}

export interface WnioskiResult {
  meta: AnalitykMeta
  zlozone: number
  wToku: number
  zaakceptowane: number
  odrzucone: number
  anulowane: number
  odsetekOdrzucen: number | null
  medianaGodzinDoDecyzji: number | null
  wgTypu: { typ: string; liczba: number }[]
  waskieGardla: {
    unitId: string
    nazwa: string
    managerUserId: string | null
    wToku: number
    najstarszyWiekDni: number
  }[]
  czasDecyzjiWgDecydenta: { decydentUserId: string; liczbaDecyzji: number; medianaGodzin: number | null }[]
}

export interface PodsumowanieResult {
  meta: AnalitykMeta
  zatrudnienie: ZatrudnienieResult
  absencje: AbsencjeResult
  czasPracy: CzasPracyResult
  urlopy: UrlopyResult
  wnioski: WnioskiResult
}

export interface PorownanieKpi {
  od: string
  do: string
  stanZatrudnienia: number
  wskaznikAbsencji: number | null
  sumaGodzin: number
  nadwyzkaPonadNorme: number
  wnioskiWToku: number
  medianaGodzinDoDecyzji: number | null
}

export interface PorownanieResult {
  biezacy: PorownanieKpi
  poprzedni: PorownanieKpi
  zmiana: PorownanieKpi
}

/** Machine code per detection rule — parity with `KodAnomalii` in analityk.anomalie.ts. */
export type KodAnomalii =
  | 'ABSENCJA_SKOK'
  | 'NADWYZKA_SKOK'
  | 'KOLEJKA_WNIOSKOW'
  | 'CZAS_DECYZJI'
  | 'SPADEK_ZATRUDNIENIA'

export type WagaAnomalii = 'wysoka' | 'srednia'

/** One detected anomaly, carrying the two values it was derived from (never an unexplained badge). */
export interface Anomalia {
  kod: KodAnomalii
  waga: WagaAnomalii
  tytul: string
  opis: string
  wartoscBiezaca: number
  wartoscPoprzednia: number
  zmiana: number
  zmianaWzgledna: number | null
}

/** `GET /analityk/anomalie` response. An empty `anomalie` array is the healthy answer. */
export interface AnomalieResult {
  biezacy: PorownanieKpi
  poprzedni: PorownanieKpi
  anomalie: Anomalia[]
}

/** The `od`/`do`/`unitId` triple every endpoint takes. */
export interface AnalitykQuery {
  od: string
  do: string
  unitId?: string
}

function qs(query: AnalitykQuery): string {
  const params = new URLSearchParams({ od: query.od, do: query.do })
  if (query.unitId) params.set('unitId', query.unitId)
  return `?${params.toString()}`
}

// --- live client ----------------------------------------------------------------------------------

export const analitykApi = {
  getPodsumowanie: (q: AnalitykQuery): Promise<PodsumowanieResult> => anFetch<PodsumowanieResult>(`/api/analityk${qs(q)}`),
  getZatrudnienie: (q: AnalitykQuery): Promise<ZatrudnienieResult> => anFetch<ZatrudnienieResult>(`/api/analityk/zatrudnienie${qs(q)}`),
  getAbsencje: (q: AnalitykQuery): Promise<AbsencjeResult> => anFetch<AbsencjeResult>(`/api/analityk/absencje${qs(q)}`),
  getCzasPracy: (q: AnalitykQuery): Promise<CzasPracyResult> => anFetch<CzasPracyResult>(`/api/analityk/czas-pracy${qs(q)}`),
  getUrlopy: (q: AnalitykQuery): Promise<UrlopyResult> => anFetch<UrlopyResult>(`/api/analityk/urlopy${qs(q)}`),
  getWnioski: (q: AnalitykQuery): Promise<WnioskiResult> => anFetch<WnioskiResult>(`/api/analityk/wnioski${qs(q)}`),
  getPorownanie: (q: AnalitykQuery): Promise<PorownanieResult> => anFetch<PorownanieResult>(`/api/analityk/porownanie${qs(q)}`),
  getAnomalie: (q: AnalitykQuery): Promise<AnomalieResult> => anFetch<AnomalieResult>(`/api/analityk/anomalie${qs(q)}`),
}

/** Tailwind classes per anomaly severity — a left stripe + a chip, mirroring the retention feed. */
export const WAGA_CLASSES: Record<WagaAnomalii, { stripe: string; chip: string; label: string }> = {
  wysoka: { stripe: 'bg-error', chip: 'border-error/30 bg-error/10 text-error', label: 'Wysoka' },
  srednia: { stripe: 'bg-warn', chip: 'border-warn/30 bg-warn/10 text-warn', label: 'Średnia' },
}

// --- pure formatters ------------------------------------------------------------------------------
//
// No network, no PII. Polish decimal convention (comma) applied by hand rather than through Intl, so
// the output is identical in the browser and under the node-environment unit tests.

/** Rendered for any figure the backend could not honestly compute (a `null`). NEVER "0". */
export const BRAK_DANYCH = '—'

/** `0.2333` → `"23,3%"`. `null` → `"—"` — an unknown rate is never shown as 0%. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return BRAK_DANYCH
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`
}

/** `102` → `"102 h"`, `9.27` → `"9,3 h"`. `null` → `"—"`. */
export function formatHours(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return BRAK_DANYCH
  const rounded = Number(value.toFixed(digits))
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits).replace('.', ',')
  return `${text} h`
}

/** `24.33` → `"24,3"`, `3` → `"3"`. `null` → `"—"`. */
export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return BRAK_DANYCH
  const rounded = Number(value.toFixed(digits))
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits).replace('.', ',')
}

/** `12` → `"12 h"` (median time-to-decision); `36` → `"1,5 dnia"` once it passes a day. */
export function formatDecisionTime(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return BRAK_DANYCH
  if (hours < 24) return formatHours(hours)
  return `${formatNumber(hours / 24)} dnia`
}

/** Signed delta for a period-over-period figure: `+5`, `-3`, `0`, or `"—"` when unknown. */
export function formatDelta(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return BRAK_DANYCH
  const text = formatNumber(value, digits)
  return value > 0 ? `+${text}` : text
}

/** Signed percentage-point delta: `+2,3 p.p.`, `-1,0 p.p.`, or `"—"`. */
export function formatDeltaPunkty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return BRAK_DANYCH
  const points = value * 100
  const text = formatNumber(points, 1)
  return `${points > 0 ? '+' : ''}${text} p.p.`
}

export type Tone = 'good' | 'bad' | 'neutral'

/**
 * Semantic tone for a period-over-period delta. `lowerIsBetter` flips the reading for metrics where
 * growth is bad (absence, backlog, time-to-decision). An unknown or zero delta is always neutral —
 * never dressed up as an improvement.
 */
export function deltaTone(value: number | null | undefined, lowerIsBetter = false): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return 'neutral'
  const rising = value > 0
  return rising === lowerIsBetter ? 'bad' : 'good'
}

/** Absence-rate thresholds: under 4% healthy, 4–8% watch, above 8% a problem. `null` → neutral. */
export function absenceTone(rate: number | null | undefined): Tone {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return 'neutral'
  if (rate < 0.04) return 'good'
  if (rate <= 0.08) return 'neutral'
  return 'bad'
}

/** Tailwind text classes per tone — kept here so tiles and charts cannot drift apart. */
export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-verified',
  bad: 'text-error',
  neutral: 'text-muted',
}

/** Tailwind fill classes per tone, for the SVG charts. */
export const TONE_FILL: Record<Tone, string> = {
  good: 'fill-verified',
  bad: 'fill-error',
  neutral: 'fill-accent',
}

const MIESIACE = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

/** `"2026-06"` → `"cze 2026"`. An unparseable key is returned unchanged rather than as "NaN". */
export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return key
  const index = Number(match[2]) - 1
  const name = MIESIACE[index]
  return name ? `${name} ${match[1]}` : key
}

/** `"URLOP_WYPOCZYNKOWY"` → `"Urlop wypoczynkowy"` — the backend keeps `type` as a raw enum string. */
export function leaveTypeLabel(type: string): string {
  const words = type.toLowerCase().split('_').filter(Boolean)
  if (words.length === 0) return type
  const first = words[0] as string
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ')
}

/** `"e1a2b3c4-…"` → `"#e1a2b3c4"` — a stable short handle for an ID-only row (no PII available). */
export function shortId(id: string): string {
  return `#${id.slice(0, 8)}`
}

/**
 * Imię i nazwisko pracownika, a `#e1a2b3c4` dopiero gdy nazwiska naprawdę nie ma.
 *
 * Analityk dostaje z backendu wiersze IDS-ONLY (`snapshot.service.ts` — do scoringu świadomie NIE
 * trafia żadne PII, żeby cecha chroniona nie mogła wpłynąć na ocenę). To ograniczenie dotyczy
 * SCORINGU i dziennika audytu, nie warstwy prezentacji: manager widzi tych samych ludzi po nazwisku
 * w Grafiku, Pracownikach i Wnioskach, więc pokazywanie mu `#839275ec` niczego nie chroniło — jedynie
 * uniemożliwiało odczytanie własnego raportu. Nazwiska dociągamy z `/api/employees` (projekcja
 * SAFE_SELECT, bez PESEL i adresu) i łączymy po id dopiero w przeglądarce.
 *
 * Zgłoszone 2026-08-10: na `/analityk` widocznych było 9 surowych identyfikatorów zamiast nazwisk.
 */
export function employeeLabel(names: Map<string, string>, id: string): string {
  const name = names.get(id)
  return name && name.trim() !== '' ? name : shortId(id)
}

// --- pure chart geometry --------------------------------------------------------------------------
//
// The web-kit ships NO charting library (see package.json), and this module deliberately adds none.
// The Analityk screen draws plain SVG, so the geometry lives here as pure functions the components
// render and the unit tests verify.

/** The scale a bar/line chart is drawn against: never 0 (which would divide by zero) — minimum 1. */
export function chartMax(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v))
  const max = finite.length > 0 ? Math.max(...finite) : 0
  return max > 0 ? max : 1
}

/**
 * Bar heights in px for a chart of `height` px. A zero value keeps a 1px stub so an empty category
 * is still visible as "measured and zero" rather than vanishing into the axis.
 */
export function barHeights(values: number[], height: number): number[] {
  const max = chartMax(values)
  return values.map((v) => {
    if (!Number.isFinite(v) || v <= 0) return 1
    return Math.max(1, Math.round((v / max) * height))
  })
}

/** Evenly spaced x-centres for `count` bars/points across `width` px. */
export function xPositions(count: number, width: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [width / 2]
  const step = width / (count - 1)
  return Array.from({ length: count }, (_, i) => Math.round(i * step * 100) / 100)
}

/**
 * An SVG polyline `points` string for a series, y-flipped so a larger value sits higher. Returns an
 * empty string for an empty series so the caller renders nothing instead of a broken path.
 */
export function linePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const max = chartMax(values)
  const xs = xPositions(values.length, width)
  return values
    .map((v, i) => {
      const safe = Number.isFinite(v) && v > 0 ? v : 0
      const y = Math.round((height - (safe / max) * height) * 100) / 100
      return `${xs[i]},${y}`
    })
    .join(' ')
}

/** Cumulative left offsets (%) for a 100%-stacked bar; a zero total yields all-zero offsets. */
export function stackOffsets(values: number[]): { offset: number; width: number }[] {
  const total = values.reduce((sum, v) => sum + (Number.isFinite(v) && v > 0 ? v : 0), 0)
  if (total <= 0) return values.map(() => ({ offset: 0, width: 0 }))
  let cursor = 0
  return values.map((v) => {
    const safe = Number.isFinite(v) && v > 0 ? v : 0
    const width = (safe / total) * 100
    const offset = cursor
    cursor += width
    return { offset: Math.round(offset * 100) / 100, width: Math.round(width * 100) / 100 }
  })
}

// --- default range --------------------------------------------------------------------------------

/** `YYYY-MM-DD` for a Date, in UTC — the format every `analityk` endpoint expects. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The screen's initial range: the last full 30 days ending today. Takes `today` explicitly so the
 * unit tests are not clock-dependent.
 */
export function defaultRange(today: Date = new Date()): AnalitykQuery {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
  return { od: toIsoDate(start), do: toIsoDate(end) }
}

/** The current calendar month so far — the other preset the range picker offers. */
export function monthToDateRange(today: Date = new Date()): AnalitykQuery {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  return { od: toIsoDate(start), do: toIsoDate(end) }
}

/** The current calendar year so far — the preset the leave-balance figures are most meaningful over. */
export function yearToDateRange(today: Date = new Date()): AnalitykQuery {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
  return { od: toIsoDate(start), do: toIsoDate(end) }
}

// --- CSV export -----------------------------------------------------------------------------------

/**
 * Serialize rows to CSV. Uses a SEMICOLON separator, the convention Polish Excel expects for a
 * comma-decimal locale, and quotes any field containing a separator, quote or newline (doubling
 * embedded quotes per RFC 4180) so a unit name with a comma can never shift the columns.
 */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null): string => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'number' ? formatNumber(value, 2) : value
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [headers, ...rows].map((row) => row.map(cell).join(';')).join('\r\n')
}

/**
 * Every caveat attached to any aggregate in the summary, de-duplicated, in the same order the screen
 * renders them. Exported so the CSV and the on-screen "Jak liczone są te wskaźniki" block cannot
 * drift apart — one list, two renderings.
 */
export function zebraneUwagi(data: PodsumowanieResult): string[] {
  return [
    ...new Set([
      ...data.meta.uwagi,
      ...data.zatrudnienie.meta.uwagi,
      ...data.absencje.meta.uwagi,
      ...data.czasPracy.meta.uwagi,
      ...data.urlopy.meta.uwagi,
      ...data.wnioski.meta.uwagi,
    ]),
  ]
}

/** `HH:mm` in a timezone-agnostic, purely mechanical `YYYY-MM-DD HH:mm` shape — this is a snapshot
 * timestamp for a downloaded file, not a user-facing clock, so no locale/timezone formatting. */
function formatGeneratedAt(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * Flatten a full summary into the CSV rows the export button downloads.
 *
 * The file ENDS WITH THE CAVEATS, and that is the point of this function's shape. `meta.uwagi` is
 * the mechanism that makes these figures honest — "leave entitlement is a flat 26 days", "the
 * surplus is not KP overtime", "departures come from account deactivations" — and this export is
 * exactly the path by which the numbers travel into a management deck or a grant annex. Shipping
 * them stripped of the caveats would strip them of the only thing keeping them truthful.
 *
 * The file also OPENS with who/when: `Najemca` (tenant name, when the caller has it — the API
 * payload itself is tenant-scoped but carries no tenant name, see `AnalitykMeta`) and
 * `Wygenerowano` (the moment this specific snapshot was produced). A CSV that travels into a
 * management deck without either can outlive its own accuracy silently — six months on, nobody
 * looking at a naked number can tell whether it is this week's or last quarter's, or whose. Both
 * are optional and additive: omitting `opts` reproduces the exact export shape byte-for-byte
 * (existing callers/tests are unaffected).
 */
export function podsumowanieToCsv(
  data: PodsumowanieResult,
  opts: { companyName?: string; generatedAt?: Date } = {},
): string {
  const rows: (string | number | null)[][] = [
    ['Stan zatrudnienia na koniec', data.zatrudnienie.stanNaKoniec, 'os.'],
    ['Przyjęcia w okresie', data.zatrudnienie.przyjecia, 'os.'],
    ['Odejścia w okresie (dezaktywacje kont)', data.zatrudnienie.odejscia, 'os.'],
    ['Rotacja w okresie (nie w ujęciu rocznym)', data.zatrudnienie.rotacjaWOkresie, 'udział'],
    ['Dni nieobecności', data.absencje.dniNieobecnosci, 'dni robocze'],
    ['Wskaźnik absencji', data.absencje.wskaznik, 'udział'],
    ['Suma godzin (z grafiku)', data.czasPracy.sumaGodzin, 'h'],
    ['Nadwyżka ponad normę tygodniową (z grafiku, nie nadgodziny KP)', data.czasPracy.nadwyzkaPonadNorme, 'h'],
    ['Niedobór do normy tygodniowej (z grafiku)', data.czasPracy.niedoborDoNormy, 'h'],
    ['Średnia dzienna', data.czasPracy.sredniaDzienna, 'h'],
    ['Wykorzystane dni urlopu', data.urlopy.wykorzystaneDni, 'dni'],
    ['Średnie saldo urlopu', data.urlopy.srednieSaldo, 'dni'],
    ['Wnioski w toku', data.wnioski.wToku, 'szt.'],
    ['Mediana czasu do decyzji', data.wnioski.medianaGodzinDoDecyzji, 'h'],
    ['Odsetek odrzuceń', data.wnioski.odsetekOdrzucen, 'udział'],
  ]
  const headerBlock: string[] = []
  if (opts.companyName) headerBlock.push(`Najemca;${opts.companyName}`)
  headerBlock.push(`Analityk HR ${data.meta.od} – ${data.meta.do}`)
  if (opts.generatedAt) headerBlock.push(`Wygenerowano;${formatGeneratedAt(opts.generatedAt)}`)
  const uwagi = zebraneUwagi(data)
  const zastrzezenia =
    uwagi.length > 0 ? ['', 'Zastrzeżenia', toCsv(['Lp.', 'Treść'], uwagi.map((u, i) => [i + 1, u]))] : []
  return [...headerBlock, toCsv(['Wskaźnik', 'Wartość', 'Jednostka'], rows), ...zastrzezenia].join('\r\n')
}
