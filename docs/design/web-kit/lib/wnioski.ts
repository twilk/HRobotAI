/**
 * Wnioski (leave-request) client model for the web-kit UAT surface.
 *
 * LIVE: `wnioskiApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js proxy
 * at `/api/wnioski/*` (see app/api/wnioski/[[...path]] + lib/tenant-runtime.ts), which forwards to
 * the NestJS `POST/GET /wnioski`, `GET /wnioski/:id`, `POST /wnioski/:id/decision`,
 * `POST /wnioski/:id/cancel` endpoints (apps/tenant-runtime/src/leave) with a cookie-resolved
 * Keycloak bearer.
 *
 * RODO: the backend's `LEAVE_SELECT` projection (leave.service.ts) never returns the `employee`
 * relation — no PESEL/home ever flows through this module. Rows carry `employeeId` only; the
 * ENRICHMENT layer below resolves it against `/api/employees` (id → "First Last"), mirroring
 * lib/ai-grafik.ts's `buildProposalEnrichMaps`.
 */

// --- enums: parity with packages/shared/src/leave.ts ------------------------------------------------

/** Lifecycle status of a leave request. Mirrors the Prisma `LeaveStatus` enum / `packages/shared`. */
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export const LEAVE_STATUSES: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']

/** Polish labels for each lifecycle status, for status badges. */
const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING: 'Oczekuje',
  APPROVED: 'Zatwierdzony',
  REJECTED: 'Odrzucony',
  CANCELLED: 'Anulowany',
}

/** Human-readable Polish label for a leave status; echoes the raw value for an unknown status. */
export function leaveStatusLabel(status: LeaveStatus): string {
  return LEAVE_STATUS_LABEL[status] ?? status
}

/**
 * The actions that drive the leave-request machine — parity with `packages/shared/src/leave.ts`'s
 * `LeaveAction` enum (`approve` / `reject` / `cancel`). Not a Prisma enum — no parity assertion there
 * either; kept in sync by hand, same convention.
 */
export type LeaveAction = 'approve' | 'reject' | 'cancel'

/**
 * `type` is a free-form string column on the backend (`CreateLeaveDto.type: @IsString`), not a Prisma
 * enum — intentionally not over-modelled server-side (see schema.prisma comment on `LeaveRequest.type`).
 * This curated list is only the set the create form's `<select>` offers; the label map below still
 * falls back gracefully for any other value a manager/HR import might have written directly.
 */
export const LEAVE_TYPES = [
  'URLOP_WYPOCZYNKOWY',
  'URLOP_NA_ZADANIE',
  'URLOP_OKOLICZNOSCIOWY',
  'URLOP_BEZPLATNY',
  'ZWOLNIENIE_LEKARSKIE',
] as const

export type LeaveType = (typeof LEAVE_TYPES)[number]

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  URLOP_WYPOCZYNKOWY: 'Urlop wypoczynkowy',
  URLOP_NA_ZADANIE: 'Urlop na żądanie',
  URLOP_OKOLICZNOSCIOWY: 'Urlop okolicznościowy',
  URLOP_BEZPLATNY: 'Urlop bezpłatny',
  ZWOLNIENIE_LEKARSKIE: 'Zwolnienie lekarskie (L4)',
}

/** Human-readable Polish label for a leave type; echoes the raw value for an unknown/free-form type. */
export function leaveTypeLabel(type: string): string {
  return LEAVE_TYPE_LABEL[type as LeaveType] ?? type
}

// --- pure validators --------------------------------------------------------------------------------

/**
 * True iff `endDate >= startDate` (a single-day leave, i.e. equal dates, is valid). Both dates are
 * `YYYY-MM-DD` strings (native lexicographic comparison is correct for that format); an empty or
 * malformed bound is invalid so the create form can't submit a half-filled range.
 */
export function validateLeaveRange(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false
  return endDate >= startDate
}

// --- state -> action helper (mirrors lib/ai-grafik.ts's aiProposalActions) --------------------------

/** The caller's relationship to a leave request — drives which actions the UI offers. */
export type LeaveRelation = 'owner' | 'decider' | null

export interface LeaveActionOption {
  action: LeaveAction
  label: string
}

/**
 * Actions offered for a leave request, given its status and the caller's relationship to it. The
 * requester ("owner") may only cancel their own still-PENDING request; a manager/HR/admin ("decider")
 * may only approve/reject a still-PENDING request. Every other combination (terminal states, no
 * relationship) offers nothing — the backend's maker-checker + status guard have the final say
 * regardless (a decider who is ALSO the owner still gets nothing here, matching the backend's
 * self-approval ban — see leave.service.ts#decide).
 */
export function leaveActions(status: LeaveStatus, relation: LeaveRelation): LeaveActionOption[] {
  if (status !== 'PENDING') return []
  if (relation === 'decider') {
    return [
      { action: 'approve', label: 'Zatwierdź' },
      { action: 'reject', label: 'Odrzuć' },
    ]
  }
  if (relation === 'owner') {
    return [{ action: 'cancel', label: 'Anuluj' }]
  }
  return []
}

// --- backend row shape + HTTP plumbing ---------------------------------------------------------------

/**
 * A `LeaveRequest` row as returned by every `/wnioski*` read/write route — the tenant-runtime's
 * `LEAVE_SELECT` allowlist projection (leave.service.ts). No `employee` relation, ever: PESEL/home
 * cannot leak through this shape.
 */
export interface LeaveRow {
  id: string
  employeeId: string
  startDate: string
  endDate: string
  status: LeaveStatus
  type: string
  decidedByUserId: string | null
  decidedAt: string | null
  reason: string | null
  createdAt: string
  updatedAt: string
}

/** {@link LeaveRow} projected onto the UI with the requester's resolved employee name. */
export interface EnrichedLeave extends LeaveRow {
  employeeName: string
}

/** Filter for {@link wnioskiApi.list}. */
export interface ListLeaveParams {
  mine?: boolean
  state?: LeaveStatus
  unitId?: string
}

/**
 * Body for {@link wnioskiApi.create} — mirrors `CreateLeaveDto` (tenant-runtime) EXACTLY: no `reason`
 * field exists on create (it is decision-only, set by {@link wnioskiApi.decide}; see leave.dto.ts).
 */
export interface CreateLeaveInput {
  startDate: string
  endDate: string
  type: string
  /** Honoured ONLY for a global (HR/ADMIN_KLIENTA) actor filing on someone's behalf; ignored otherwise. */
  employeeId?: string
}

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 409 (conflict). */
export class WnioskiApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'WnioskiApiError'
  }
}

async function wnioskiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new WnioskiApiError(res.status, humanizeError(detail) || res.statusText)
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

// --- enrichment: employeeId -> name (mirrors lib/ai-grafik.ts's buildProposalEnrichMaps) -----------

interface EmployeeLite {
  id: string
  firstName: string
  lastName: string
}

/** Fetch the roster once (same-origin proxy) and build the id→name map. */
export async function buildLeaveEnrichMap(): Promise<Map<string, string>> {
  const emps = await wnioskiFetch<EmployeeLite[]>('/api/employees')
  const empName = new Map<string, string>()
  for (const e of emps) empName.set(e.id, `${e.firstName} ${e.lastName}`.trim())
  return empName
}

/** Project a raw backend row onto the {@link EnrichedLeave} shape the UI renders. */
export function enrichLeave(row: LeaveRow, empName: ReadonlyMap<string, string>): EnrichedLeave {
  return { ...row, employeeName: empName.get(row.employeeId) ?? row.employeeId.slice(0, 8) }
}

/** Project many raw rows onto {@link EnrichedLeave} against an already-built map (no fetch). */
export function enrichLeavesWith(rows: LeaveRow[], empName: ReadonlyMap<string, string>): EnrichedLeave[] {
  return rows.map((r) => enrichLeave(r, empName))
}

async function enrichLeaves(rows: LeaveRow[]): Promise<EnrichedLeave[]> {
  if (rows.length === 0) return []
  const empName = await buildLeaveEnrichMap()
  return rows.map((r) => enrichLeave(r, empName))
}

// --- wnioskiApi: real fetch against /api/wnioski/* --------------------------------------------------

/**
 * The Wnioski API the screen talks to — same-origin `fetch` calls to the tenant-runtime proxy, with
 * the requester's employeeId enriched to a name client-side. The backend RBAC + maker-checker +
 * status guard have the final say; illegal actions surface as {@link WnioskiApiError}.
 */
export const wnioskiApi = {
  /**
   * RAW list — no enrichment fetch. A caller combining several sub-lists in one refresh tick (e.g. own
   * + decision inbox) should fetch each with this, build the map ONCE via {@link buildLeaveEnrichMap},
   * then enrich the combined rows with {@link enrichLeavesWith}. Prefer {@link wnioskiApi.list} for a
   * single one-off list.
   */
  listRaw(params: ListLeaveParams = {}): Promise<LeaveRow[]> {
    const qs = new URLSearchParams()
    if (params.mine) qs.set('mine', 'true')
    if (params.state) qs.set('state', params.state)
    if (params.unitId) qs.set('unitId', params.unitId)
    const query = qs.toString()
    return wnioskiFetch<LeaveRow[]>(`/api/wnioski${query ? `?${query}` : ''}`)
  },

  async list(params: ListLeaveParams = {}): Promise<EnrichedLeave[]> {
    const rows = await wnioskiApi.listRaw(params)
    return enrichLeaves(rows)
  },

  async create(input: CreateLeaveInput): Promise<EnrichedLeave> {
    const row = await wnioskiFetch<LeaveRow>('/api/wnioski', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return enrichLeave(row, await buildLeaveEnrichMap())
  },

  async getById(id: string): Promise<EnrichedLeave> {
    const row = await wnioskiFetch<LeaveRow>(`/api/wnioski/${id}`)
    return enrichLeave(row, await buildLeaveEnrichMap())
  },

  /** Manager/HR/admin decision. Maker-checker (no self-approval) + status guard: enforced server-side. */
  async decide(id: string, approve: boolean, reason?: string): Promise<EnrichedLeave> {
    const row = await wnioskiFetch<LeaveRow>(`/api/wnioski/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(reason ? { approve, reason } : { approve }),
    })
    return enrichLeave(row, await buildLeaveEnrichMap())
  },

  /** Requester cancels their own still-PENDING request. */
  async cancel(id: string): Promise<EnrichedLeave> {
    const row = await wnioskiFetch<LeaveRow>(`/api/wnioski/${id}/cancel`, { method: 'POST' })
    return enrichLeave(row, await buildLeaveEnrichMap())
  },
}
