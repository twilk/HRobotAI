/**
 * AI Grafik Manager client model for the web-kit UAT surface.
 *
 * LIVE: `aiGrafikApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js proxy
 * at `/api/ai-grafik/*` (see app/api/ai-grafik/[[...path]] + lib/tenant-runtime.ts), which forwards to
 * the NestJS `GET`/`PATCH /ai-grafik/config` endpoints with a cookie-resolved Keycloak bearer.
 *
 * The pure helpers (autonomyLabel / validateQuietHours) are exported separately so the config panel and
 * the unit tests share one source of truth. No PII ever flows through here — the config is tenant-wide
 * scheduling policy (autonomy, consent TTL, quiet hours), not personal data.
 */

/** Autonomy tiers — parity with the tenant `AutonomyLevel` enum (packages/db tenant schema.prisma). */
export type AutonomyLevel = 'SUGGEST_ONLY' | 'AUTO_NOTIFY' | 'AUTO_ASK_CONSENT' | 'AUTO_COMMIT_ON_APPROVAL'

export const AUTONOMY_LEVELS: AutonomyLevel[] = [
  'SUGGEST_ONLY',
  'AUTO_NOTIFY',
  'AUTO_ASK_CONSENT',
  'AUTO_COMMIT_ON_APPROVAL',
]

/** Polish labels for each autonomy tier, for the config <select> and any legends. */
const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  SUGGEST_ONLY: 'Tylko sugestie',
  AUTO_NOTIFY: 'Automatycznie z powiadomieniem',
  AUTO_ASK_CONSENT: 'Automatycznie za zgodą pracownika',
  AUTO_COMMIT_ON_APPROVAL: 'Automatycznie po zatwierdzeniu',
}

/** Human-readable Polish label for an autonomy level; echoes the raw value for an unknown level. */
export function autonomyLabel(level: AutonomyLevel): string {
  return AUTONOMY_LABEL[level] ?? level
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Quiet-hours are valid when BOTH bounds are empty (feature off) or BOTH are a well-formed `HH:mm`
 * time. One-sided input (only a start or only an end) is rejected so the backend never stores a
 * half-configured window. Whitespace-only counts as empty.
 */
export function validateQuietHours(start: string, end: string): boolean {
  const s = start.trim()
  const e = end.trim()
  if (s === '' && e === '') return true
  return HHMM_RE.test(s) && HHMM_RE.test(e)
}

/** Tenant-wide AI scheduling policy — the subset of `AiSchedulingConfig` this panel reads/writes. */
export interface AiConfig {
  autonomyLevel: AutonomyLevel
  consentTtlHours: number
  /** `HH:mm` or null when quiet-hours are off. */
  quietHoursStart: string | null
  quietHoursEnd: string | null
}

/** Fields the config form can PATCH. Same shape as {@link AiConfig}. */
export type AiConfigUpdate = AiConfig

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 502 (down). */
export class AiGrafikApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AiGrafikApiError'
  }
}

async function aiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new AiGrafikApiError(res.status, humanizeError(detail) || res.statusText)
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

export const aiGrafikApi = {
  getConfig(): Promise<AiConfig> {
    return aiFetch<AiConfig>('/api/ai-grafik/config')
  },
  updateConfig(input: AiConfigUpdate): Promise<AiConfig> {
    return aiFetch<AiConfig>('/api/ai-grafik/config', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
}

// --- AI proposal inbox (Task 1.5): manager approval + employee consent -----------------------------
//
// Same proxy plumbing as `aiGrafikApi` above (aiFetch/AiGrafikApiError), extended to the
// `/ai-grafik/proposals*` + `/ai-grafik/replacements/scan` routes
// (apps/tenant-runtime/src/ai-grafik/ai-grafik.controller.ts). The backend returns raw ids only
// (shiftId, vacatedEmployeeId, candidate.employeeId) — never employee names/PII — so this module
// enriches them the same way lib/swaps.ts does: fetch `/api/employees` + `/api/grafik/shifts` and
// build id→label maps. `aiProposalApi.listProposals`/`consent`/`managerDecision`/`createForShift`
// each build their own maps for a single one-off call; a caller that needs several sub-lists in one
// tick (e.g. proposal-inbox.tsx's `refresh()`) should instead call `listProposalsRaw` per sub-list,
// build the maps ONCE via `buildProposalEnrichMaps`, and enrich the combined rows with
// `enrichProposalsWith` — see those exports below. IDS ONLY in the backend contract; enrichment is
// always client-side.

/** Lifecycle state of an AI proposal — parity with `packages/shared/src/ai-grafik.ts` `AiProposalState`. */
export type AiProposalState =
  | 'DRAFT'
  | 'PENDING_EMPLOYEE_CONSENT'
  | 'EMPLOYEE_AGREED'
  | 'PENDING_MANAGER'
  | 'APPROVED'
  | 'REJECTED'
  | 'ESCALATED'
  | 'CANCELLED'

/** Kind of AI proposal — parity with the Prisma `AiProposalType` enum. */
export type AiProposalType = 'REPLACEMENT' | 'ADHOC' | 'CAPACITY'

/** Per-candidate consent status — parity with the Prisma `ConsentState` enum. */
export type ConsentState = 'NOT_ASKED' | 'PENDING' | 'GRANTED' | 'DECLINED' | 'EXPIRED'

/** Polish labels for each proposal lifecycle state, for badges/legends. */
const PROPOSAL_STATE_LABEL: Record<AiProposalState, string> = {
  DRAFT: 'Szkic',
  PENDING_EMPLOYEE_CONSENT: 'Czeka na zgodę pracownika',
  EMPLOYEE_AGREED: 'Pracownik się zgodził',
  PENDING_MANAGER: 'Czeka na managera',
  APPROVED: 'Zatwierdzona',
  REJECTED: 'Odrzucona',
  ESCALATED: 'Eskalowana',
  CANCELLED: 'Anulowana',
}

/** Human-readable Polish label for a proposal state; echoes the raw value for an unknown state. */
export function proposalStateLabel(state: AiProposalState): string {
  return PROPOSAL_STATE_LABEL[state] ?? state
}

/** A raw candidate row as returned by the tenant-runtime (ids only — no employee name). */
export interface AiProposalCandidate {
  id: string
  employeeId: string
  rank: number
  feasible: boolean
  reason?: string | null
  score?: number | null
  consentState: ConsentState
  consentRequestedAt?: string | null
  consentAt?: string | null
}

/** A raw AiProposal row as returned by the tenant-runtime `/ai-grafik/proposals*` routes (ids only). */
export interface AiProposal {
  id: string
  type: AiProposalType
  state: AiProposalState
  shiftId: string
  vacatedEmployeeId: string
  activeCandidateId: string | null
  reason?: string | null
  expiresAt?: string | null
  decidedByManagerId?: string | null
  createdAt: string
  updatedAt: string
  candidates: AiProposalCandidate[]
}

/** {@link AiProposalCandidate} projected onto the UI with the candidate's resolved employee name. */
export interface EnrichedCandidate extends AiProposalCandidate {
  employeeName: string
}

/** {@link AiProposal} projected onto the UI: candidates + the vacated employee + the shift, all named. */
export interface EnrichedProposal extends Omit<AiProposal, 'candidates'> {
  candidates: EnrichedCandidate[]
  vacatedEmployeeName: string
  shiftLabel: string
}

/** One APPROVED-leave interval covering a {@link VacatedShift}'s employee (RODO-safe). */
export interface VacatedShiftLeave {
  id: string
  startDate: string
  endDate: string
  status: string
  employeeId: string
}

/**
 * A vacated shift as returned by `POST /ai-grafik/replacements/scan` — a RODO-safe employee
 * projection (id/unitId/firstName/lastName/position, no PESEL/home) plus the APPROVED leave(s)
 * covering the shift's date. Already carries a human-readable name, unlike the proposal contract.
 */
export interface VacatedShift {
  id: string
  date: string
  start: string
  end: string
  role: string
  employeeId: string
  lokalizacjaId: string
  employee: {
    id: string
    unitId: string
    firstName: string
    lastName: string
    position: string | null
    leaves: VacatedShiftLeave[]
  }
}

/** Filter for {@link aiProposalApi.listProposals}. */
export interface ListProposalsParams {
  mine?: boolean
  state?: AiProposalState
}

/** One action the current caller may take on a proposal, keyed to {@link aiProposalApi}'s mutations. */
export type ProposalActionKind = 'approve' | 'reject' | 'accept' | 'decline'

export interface ProposalAction {
  action: ProposalActionKind
  label: string
}

/**
 * Actions offered for a proposal, given its state and the caller's relationship to it. A manager only
 * gets approve/reject while the proposal awaits their review (PENDING_MANAGER); the active consent
 * candidate only gets accept/decline while it awaits THEIR consent (PENDING_EMPLOYEE_CONSENT). Every
 * other state (including all terminal ones) offers nothing — the backend state machine has the final
 * say regardless; this is purely which buttons the UI shows.
 */
export function aiProposalActions(
  state: AiProposalState,
  mineRole: 'manager' | 'employee' | null,
): ProposalAction[] {
  if (mineRole === 'manager' && state === 'PENDING_MANAGER') {
    return [
      { action: 'approve', label: 'Zatwierdź' },
      { action: 'reject', label: 'Odrzuć' },
    ]
  }
  if (mineRole === 'employee' && state === 'PENDING_EMPLOYEE_CONSENT') {
    return [
      { action: 'accept', label: 'Akceptuj' },
      { action: 'decline', label: 'Odrzuć' },
    ]
  }
  return []
}

/**
 * True iff `myEmployeeId` is the proposal's ACTIVE candidate, still PENDING, while the proposal itself
 * awaits employee consent. Mirrors `AiProposalService`'s own `isMyActivePending` gate so the UI's
 * "does this need MY consent" question matches the server's — the server always has the final say on
 * any actual mutation.
 */
export function isMineToConsent(
  proposal: Pick<AiProposal, 'state' | 'activeCandidateId' | 'candidates'>,
  myEmployeeId: string | null,
): boolean {
  if (myEmployeeId == null) return false
  if (proposal.state !== 'PENDING_EMPLOYEE_CONSENT') return false
  const active = proposal.candidates.find((c) => c.id === proposal.activeCandidateId)
  return active != null && active.employeeId === myEmployeeId && active.consentState === 'PENDING'
}

// --- enrichment: backend ids → UI labels/names (mirrors lib/swaps.ts) ------------------------------

interface EmployeeLite {
  id: string
  firstName: string
  lastName: string
}
interface ShiftLite {
  id: string
  date: string
  start: string
  end: string
  role: string
}

export interface ProposalEnrichMaps {
  empName: Map<string, string>
  shiftLabel: Map<string, string>
}

const WEEKDAY_SHORT_PL = ['nd', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'] as const

/**
 * "pon 13.07 · 06:00–14:00 · RECEPCJA" from a shift row (date is UTC `YYYY-MM-DD[...]`). Exported so
 * callers with an inline shift shape (e.g. {@link VacatedShift}, which already carries date/start/
 * end/role — no id lookup needed) can reuse the exact same formatting instead of re-deriving it.
 */
export function shiftLabelOf(s: ShiftLite): string {
  const iso = s.date.slice(0, 10)
  const d = new Date(`${iso}T00:00:00.000Z`)
  const wd = WEEKDAY_SHORT_PL[d.getUTCDay()]
  const dd = iso.slice(8, 10)
  const mm = iso.slice(5, 7)
  return `${wd} ${dd}.${mm} · ${s.start}–${s.end} · ${s.role}`
}

/**
 * Fetch the roster + shifts once (same-origin proxy) and build the id→name / id→shift-label maps.
 * Exported so a caller that needs several sub-lists in one refresh tick (e.g. proposal-inbox.tsx's
 * `refresh()`, which combines `mine` + PENDING_MANAGER + DRAFT + ESCALATED) can build the maps ONCE
 * and reuse them across every sub-list via {@link enrichProposalsWith}, instead of each list call
 * re-fetching /api/employees + /api/grafik/shifts on its own.
 */
export async function buildProposalEnrichMaps(): Promise<ProposalEnrichMaps> {
  const [emps, shifts] = await Promise.all([
    aiFetch<EmployeeLite[]>('/api/employees'),
    aiFetch<ShiftLite[]>('/api/grafik/shifts'),
  ])
  const empName = new Map<string, string>()
  for (const e of emps) empName.set(e.id, `${e.firstName} ${e.lastName}`.trim())
  const shiftLabel = new Map<string, string>()
  for (const s of shifts) shiftLabel.set(s.id, shiftLabelOf(s))
  return { empName, shiftLabel }
}

/** Project a raw backend proposal row onto the {@link EnrichedProposal} shape the UI renders. */
function enrichProposal(row: AiProposal, maps: ProposalEnrichMaps): EnrichedProposal {
  const { candidates, ...rest } = row
  return {
    ...rest,
    candidates: candidates.map((c) => ({
      ...c,
      employeeName: maps.empName.get(c.employeeId) ?? c.employeeId.slice(0, 8),
    })),
    vacatedEmployeeName: maps.empName.get(row.vacatedEmployeeId) ?? row.vacatedEmployeeId.slice(0, 8),
    shiftLabel: maps.shiftLabel.get(row.shiftId) ?? row.shiftId.slice(0, 8),
  }
}

/** Project many raw rows onto {@link EnrichedProposal} against an already-built map pair (no fetch). */
export function enrichProposalsWith(rows: AiProposal[], maps: ProposalEnrichMaps): EnrichedProposal[] {
  return rows.map((r) => enrichProposal(r, maps))
}

async function enrichProposals(rows: AiProposal[]): Promise<EnrichedProposal[]> {
  if (rows.length === 0) return []
  const maps = await buildProposalEnrichMaps()
  return rows.map((r) => enrichProposal(r, maps))
}

/**
 * The caller's own Employee id via `GET /employees/me`, or null when they have no employee record
 * (the backend 404s in that case — e.g. an ADMIN_KLIENTA/HR/MANAGER actor with no Employee row).
 */
export async function fetchMyEmployeeId(): Promise<string | null> {
  try {
    const me = await aiFetch<{ id: string }>('/api/employees/me')
    return me.id
  } catch (err) {
    if (err instanceof AiGrafikApiError && (err.status === 404 || err.status === 403)) return null
    throw err
  }
}

/**
 * The AI proposal client — real fetches against `/api/ai-grafik/*`, enriched with employee names +
 * shift labels client-side. The backend RBAC + `AiProposalService` state machine have the final say;
 * illegal actions surface as {@link AiGrafikApiError}.
 */
export const aiProposalApi = {
  /**
   * RAW list — no enrichment fetch. For a caller that needs several sub-lists per refresh tick (see
   * {@link buildProposalEnrichMaps}'s doc), fetch each list with this, build the maps ONCE, then
   * enrich the combined rows with {@link enrichProposalsWith}. Prefer {@link aiProposalApi.listProposals}
   * for a single one-off list.
   */
  listProposalsRaw: (params: ListProposalsParams = {}): Promise<AiProposal[]> => {
    const qs = new URLSearchParams()
    if (params.mine) qs.set('mine', 'true')
    if (params.state) qs.set('state', params.state)
    const query = qs.toString()
    return aiFetch<AiProposal[]>(`/api/ai-grafik/proposals${query ? `?${query}` : ''}`)
  },

  listProposals: async (params: ListProposalsParams = {}): Promise<EnrichedProposal[]> => {
    const rows = await aiProposalApi.listProposalsRaw(params)
    return enrichProposals(rows)
  },

  /**
   * Manager (or HR/ADMIN) action: advance a DRAFT proposal by asking the top feasible candidate for
   * consent (Fix 1 — DRAFT otherwise has no path forward under SUGGEST_ONLY/AUTO_NOTIFY autonomy).
   * Does NOT skip consent or manager approval — moves DRAFT -> PENDING_EMPLOYEE_CONSENT (or ->
   * ESCALATED when no feasible candidate remains).
   */
  requestConsent: async (id: string): Promise<EnrichedProposal> => {
    const row = await aiFetch<AiProposal>(`/api/ai-grafik/proposals/${id}/request-consent`, {
      method: 'POST',
    })
    return enrichProposal(row, await buildProposalEnrichMaps())
  },

  /** The asked employee's answer to their consent request. */
  consent: async (id: string, accept: boolean): Promise<EnrichedProposal> => {
    const row = await aiFetch<AiProposal>(`/api/ai-grafik/proposals/${id}/consent`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    })
    return enrichProposal(row, await buildProposalEnrichMaps())
  },

  /** A manager's verdict on a PENDING_MANAGER proposal; `approve` runs the transactional commit. */
  managerDecision: async (id: string, approve: boolean): Promise<EnrichedProposal> => {
    const row = await aiFetch<AiProposal>(`/api/ai-grafik/proposals/${id}/manager-decision`, {
      method: 'POST',
      body: JSON.stringify({ approve }),
    })
    return enrichProposal(row, await buildProposalEnrichMaps())
  },

  /** Manager: detect vacated shifts (assigned employee on APPROVED leave) in `[from, to]`. Read-only. */
  scan: (from: string, to: string): Promise<VacatedShift[]> =>
    aiFetch<VacatedShift[]>('/api/ai-grafik/replacements/scan', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),

  /** Manager: create a replacement proposal for a vacated shift (ranks candidates, autonomy-gated). */
  createForShift: async (shiftId: string, reason?: string): Promise<EnrichedProposal> => {
    const row = await aiFetch<AiProposal>(`/api/ai-grafik/proposals/for-shift/${shiftId}`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    })
    return enrichProposal(row, await buildProposalEnrichMaps())
  },
}
