/**
 * `dokumenty` (Moduł Dokumenty, M3) client model for the web-kit UAT surface.
 *
 * LIVE: `dokumentyApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js
 * proxy at `/api/dokumenty/*` (see app/api/dokumenty/[[...path]] + lib/tenant-runtime.ts), which
 * forwards to the NestJS `dokumenty` controller (apps/tenant-runtime/src/dokumenty/dokumenty.controller.ts)
 * with a cookie-resolved Keycloak bearer.
 *
 * Mirrors lib/strategic-brain.ts: a thin `dokFetch` wrapper + a `DokumentyError` carrying the
 * upstream HTTP status, plus PURE formatting calculators exported separately so the screen
 * (app/(tenant)/dokumenty/page.tsx + components/dokumenty/*) and the unit tests share one source of
 * truth. Every calculator here operates on ALREADY-COMPUTED backend output (`computedFacts` is
 * ids+numbers only, frozen at generation time — SPEC §6) — none of them touch PII or recompute the
 * RCP/nadgodziny engine (that lives entirely server-side in rcp.util.ts/overtime.util.ts).
 *
 * `:id/pobierz` is deliberately NOT wired through `dokFetch`: it streams a binary PDF or a text XML,
 * not JSON. `dokumentyApi.pobierzUrl` returns the plain proxy path so the UI can point an `<a href>`
 * at it directly and let the browser handle the byte stream + `Content-Disposition` filename (see the
 * route's own comment for why `proxyToTenantRuntime` had to become binary-safe for this to work).
 */

// --- enums: parity with apps/tenant-runtime/src/dokumenty/dokumenty.enums.ts (hand-kept Prisma mirror) --

export type DocumentType = 'EWIDENCJA_CZASU_PRACY' | 'NADGODZINY' | 'ZUS_KEDU'
export const DOCUMENT_TYPES: DocumentType[] = ['EWIDENCJA_CZASU_PRACY', 'NADGODZINY', 'ZUS_KEDU']

export type DocumentFormat = 'PDF' | 'XML_KEDU'
export const DOCUMENT_FORMATS: DocumentFormat[] = ['PDF', 'XML_KEDU']

/** GENERATED → APPROVED (human gate) or → SUPERSEDED (append-only regenerate). Deliberately no
 *  SENT/EXPORTED_EXTERNAL member — the module never sends anything externally (art. 22 RODO, DOK-10). */
export type DocumentStatus = 'GENERATED' | 'APPROVED' | 'SUPERSEDED'

export type DocScopeType = 'EMPLOYEE' | 'UNIT' | 'ALL'
export const DOC_SCOPE_TYPES: DocScopeType[] = ['EMPLOYEE', 'UNIT', 'ALL']

// --- API response types (mirror DOC_SAFE_SELECT in dokumenty.service.ts) ------------------------------

/**
 * One employee's frozen numeric result inside a document's `computedFacts` (`buildComputedFacts` in
 * dokumenty.service.ts) — ids + minutes ONLY, never PESEL/name (SPEC §6, DOK-11). Every field here is
 * produced by plain TypeScript arithmetic in rcp.util.ts/overtime.util.ts (not a Prisma `Decimal`
 * column), so — unlike the `PerformanceConfig` weights in lib/strategic-brain.ts — these arrive as
 * real JSON numbers, not `number | string`.
 */
export interface DocumentEmployeeFacts {
  employeeId: string
  workedMinutes: number
  ot50Min: number
  ot100Min: number
  ot100NightSundayHolidayMin: number
  daysWithoutRcp: number
}

/** `GeneratedDocument.computedFacts` (SPEC §2.3/§6) — the frozen inputs behind a document's numbers. */
export interface DocumentComputedFacts {
  type: DocumentType
  scopeType: DocScopeType
  periodStart: string
  periodEnd: string
  algorithmVersion: number
  employees: DocumentEmployeeFacts[]
}

/**
 * `GeneratedDocument` metadata row — the `DOC_SAFE_SELECT` projection every `/dokumenty*` read route
 * returns (dokumenty.service.ts). Deliberately excludes `contentText`/`contentBytes`/`contentPath`:
 * content (which for ZUS carries PESEL) never travels over this list/metadata shape, only via
 * `pobierz` for an authorized caller (SPEC §6).
 */
export interface GeneratedDocument {
  id: string
  type: DocumentType
  format: DocumentFormat
  status: DocumentStatus
  /** `YYYY-MM-DD`-or-ISO calendar dates (Prisma `@db.Date`). */
  periodStart: string
  periodEnd: string
  scopeType: DocScopeType
  employeeId: string | null
  unitId: string | null
  contentHash: string
  computedFacts: DocumentComputedFacts
  algorithmVersion: number
  replacesDocumentId: string | null
  generatedByUserId: string
  generatedAt: string
  approvedByUserId: string | null
  approvedAt: string | null
  retentionUntil: string | null
  createdAt: string
}

/** `POST /dokumenty/generuj` body — mirrors `GenerujDokumentDto` EXACTLY (class-validator DTO). */
export interface GenerujDokumentInput {
  type: DocumentType
  format: DocumentFormat
  scopeType: DocScopeType
  /** Calendar date `YYYY-MM-DD`. */
  periodStart: string
  periodEnd: string
  employeeId?: string
  unitId?: string
}

// --- fetch plumbing (mirrors sbFetch/StrategicBrainError in lib/strategic-brain.ts) -------------------

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC/scope) / 400
 *  (DTO validation) / 404 / 409 (approval-gate state conflict). */
export class DokumentyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DokumentyError'
  }
}

async function dokFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new DokumentyError(res.status, humanizeError(detail) || res.statusText)
  }
  if (res.status === 204) return undefined as T
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

// --- live client ---------------------------------------------------------------------------------

export const dokumentyApi = {
  /** Metadata list (no content, no PESEL). HR/ADMIN see all; MANAGER only their units (server-scoped). */
  list: (): Promise<GeneratedDocument[]> => dokFetch<GeneratedDocument[]>('/api/dokumenty'),

  /** The caller's OWN ewidencja only (SPEC §5, DECYZJA-4M #6) — any authenticated employee, PRACOWNIK
   *  included. Route ordering (`mine` before `:id`) is enforced server-side in the controller. */
  mine: (): Promise<GeneratedDocument[]> => dokFetch<GeneratedDocument[]>('/api/dokumenty/mine'),

  getById: (id: string): Promise<GeneratedDocument> => dokFetch<GeneratedDocument>(`/api/dokumenty/${id}`),

  /** Generate (or, if a matching GENERATED/APPROVED row exists, append-only-supersede) a document. */
  generuj: (input: GenerujDokumentInput): Promise<GeneratedDocument> =>
    dokFetch<GeneratedDocument>('/api/dokumenty/generuj', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Human approval gate (art. 22 RODO): NADGODZINY/ZUS_KEDU GENERATED → APPROVED. Sends NOTHING
   *  externally — this is a local stamp only (DOK-10). */
  zatwierdz: (id: string): Promise<GeneratedDocument> =>
    dokFetch<GeneratedDocument>(`/api/dokumenty/${id}/zatwierdz`, { method: 'POST' }),

  /**
   * The same-origin proxy path for a document's binary/text content — NOT fetched via `dokFetch`
   * (it's a PDF/XML stream, not JSON). Point an `<a href={...} target="_blank">` at this directly;
   * the browser reads the `Content-Type`/`Content-Disposition` the proxy now forwards verbatim.
   */
  pobierzUrl: (id: string): string => `/api/dokumenty/${id}/pobierz`,
}

// --- pure formatting calculators -------------------------------------------------------------------
//
// No network, no PII: every function below is a pure projection of already-computed backend output
// (a GeneratedDocument row / its computedFacts) onto Polish display text. Kept separate from the fetch
// layer so the components AND the unit tests share exactly one source of truth (mirrors
// retentionLabel/verdictLabel in lib/strategic-brain.ts).

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  EWIDENCJA_CZASU_PRACY: 'Ewidencja czasu pracy',
  NADGODZINY: 'Nadgodziny',
  ZUS_KEDU: 'Eksport ZUS/Płatnik (KEDU)',
}

/** Polish label for a `DocumentType` (table cell / generuj-form option); echoes the raw value for an
 *  unknown type rather than throwing. */
export function documentTypeLabel(type: DocumentType): string {
  return DOCUMENT_TYPE_LABEL[type] ?? type
}

const DOCUMENT_FORMAT_LABEL: Record<DocumentFormat, string> = {
  PDF: 'PDF',
  XML_KEDU: 'XML (KEDU)',
}

/** Polish label for a `DocumentFormat`. */
export function documentFormatLabel(format: DocumentFormat): string {
  return DOCUMENT_FORMAT_LABEL[format] ?? format
}

const SCOPE_LABEL: Record<DocScopeType, string> = {
  EMPLOYEE: 'Pracownik',
  UNIT: 'Jednostka',
  ALL: 'Cała firma',
}

/** Polish label for a `DocScopeType` (independent of WHICH employee/unit — id→name enrichment for
 *  that is the screen's job via `/api/employees` / `ustawieniaApi.listUnits`, mirroring
 *  components/dostepy/dostepy-screen.tsx's employee-roster enrichment). */
export function scopeLabel(scopeType: DocScopeType): string {
  return SCOPE_LABEL[scopeType] ?? scopeType
}

/** Semantic tone key, restricted to the `Badge` component's own tone union (components/ui/badge.tsx). */
export type DocumentStatusTone = 'ok' | 'warn' | 'muted'

const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, { label: string; tone: DocumentStatusTone }> = {
  GENERATED: { label: 'Do zatwierdzenia', tone: 'warn' },
  APPROVED: { label: 'Zatwierdzony', tone: 'ok' },
  SUPERSEDED: { label: 'Zastąpiony', tone: 'muted' },
}

/** Polish label + semantic tone for a `DocumentStatus` (list badge). */
export function documentStatusLabel(status: DocumentStatus): { label: string; tone: DocumentStatusTone } {
  return DOCUMENT_STATUS_LABEL[status] ?? { label: status, tone: 'muted' }
}

/** `"01.07.2026"` from an ISO date/datetime string — matches components/dostepy/dostepy-screen.tsx's
 *  dd.mm.yyyy formatting habit. Tolerates a bare `YYYY-MM-DD` (the DTO's own wire format) as well as a
 *  full ISO timestamp (what a Prisma `@db.Date` column round-trips as over JSON). */
export function formatDate(iso: string): string {
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return d
  return `${day}.${m}.${y}`
}

/** `"01.07.2026 – 31.07.2026"` — a document's period, both bounds formatted with {@link formatDate}. */
export function formatPeriodRange(periodStart: string, periodEnd: string): string {
  return `${formatDate(periodStart)} – ${formatDate(periodEnd)}`
}

/**
 * `"8h 30m"` from a minute count, `"—"` for `null` (RCP null-policy, SPEC §3.1: "brak danych" ≠ "0
 * godzin" — a day with no RCP events keeps `workedMinutes: null` server-side; a screen that sums such
 * rows must be able to display "no data" distinctly from a genuine zero). Negative input (not expected
 * in practice) renders with a leading `-` rather than silently flipping sign.
 */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—'
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(Math.round(minutes))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${sign}${h}h ${m}m`
}

/** Sums of a document's already-computed overtime facts across every employee in its scope. `ot100Min`
 *  here is the COMBINED 100% bucket (weekly-average + night/Sunday/holiday — both premiumed at 100%,
 *  SPEC §3.2); the two are kept separate in `DocumentEmployeeFacts` (mirroring the engine's own
 *  double-counting guard) but collapsed for display since the UI shows one "100%" figure. */
export interface OvertimeTotals {
  ot50Min: number
  ot100Min: number
  totalMin: number
  daysWithoutRcp: number
}

/** Pure aggregator over `DocumentComputedFacts.employees` — no recomputation of the engine's numbers,
 *  only a sum of what the backend already froze at generation time (SPEC §7: "Kalkulatory operują na
 *  już policzonym wyjściu backendu"). */
export function overtimeTotals(facts: DocumentComputedFacts): OvertimeTotals {
  return facts.employees.reduce<OvertimeTotals>(
    (acc, e) => {
      const ot100 = (e.ot100Min ?? 0) + (e.ot100NightSundayHolidayMin ?? 0)
      return {
        ot50Min: acc.ot50Min + (e.ot50Min ?? 0),
        ot100Min: acc.ot100Min + ot100,
        totalMin: acc.totalMin + (e.ot50Min ?? 0) + ot100,
        daysWithoutRcp: acc.daysWithoutRcp + (e.daysWithoutRcp ?? 0),
      }
    },
    { ot50Min: 0, ot100Min: 0, totalMin: 0, daysWithoutRcp: 0 },
  )
}

/**
 * One-line Polish summary of a document's overtime totals (NADGODZINY list-row subtext), e.g.
 * `"łącznie 6h 0m · 50%: 4h 0m · 100%: 2h 0m"`, or `"brak danych RCP: 2 dni"` appended when the
 * underlying rows excluded any day for missing RCP (null-policy — never silently folded into 0).
 * `"Brak nadgodzin"` when every bucket is zero (still reports a `daysWithoutRcp` caveat if present).
 */
export function formatOvertimeSummary(facts: DocumentComputedFacts): string {
  const t = overtimeTotals(facts)
  const parts: string[] = []
  if (t.totalMin === 0) {
    parts.push('Brak nadgodzin')
  } else {
    parts.push(`łącznie ${formatMinutes(t.totalMin)}`)
    if (t.ot50Min > 0) parts.push(`50%: ${formatMinutes(t.ot50Min)}`)
    if (t.ot100Min > 0) parts.push(`100%: ${formatMinutes(t.ot100Min)}`)
  }
  if (t.daysWithoutRcp > 0) parts.push(`brak danych RCP: ${t.daysWithoutRcp} dni`)
  return parts.join(' · ')
}

/** Total worked minutes across every employee in a document's scope (EWIDENCJA list-row subtext) —
 *  a plain sum of the already-computed per-employee totals, formatted via {@link formatMinutes}. */
export function formatWorkedTotal(facts: DocumentComputedFacts): string {
  const total = facts.employees.reduce((sum, e) => sum + (e.workedMinutes ?? 0), 0)
  return formatMinutes(total)
}

/** Whether a document type is subject to the human approval gate (SPEC §5, DOK-6) — mirrors the
 *  backend's `APPROVABLE_TYPES` (dokumenty.service.ts) BY VALUE (same cross-layer convention
 *  CONFIDENCE_DISCLOSURE_THRESHOLD uses in lib/strategic-brain.ts). Ewidencja is final on generate. */
export function isApprovable(type: DocumentType): boolean {
  return type === 'NADGODZINY' || type === 'ZUS_KEDU'
}
