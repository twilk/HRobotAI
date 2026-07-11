/**
 * Shift-swap client model for the web-kit UAT surface.
 *
 * LIVE: `swapApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js proxy
 * at `/api/shift-swap/*` (see app/api/shift-swap/[[...path]] + lib/tenant-runtime.ts), which forwards
 * to the NestJS endpoints `POST /shift-swap`, `/:id/submit`, `/:id/peer-decision`,
 * `/:id/submit-to-manager`, `/:id/manager-decision`, `/:id/cancel`, `GET /shift-swap?state=&mine=`
 * (apps/tenant-runtime/src/shift-swap) with a self-minted Keycloak bearer.
 *
 * IMPEDANCE MISMATCH: the backend returns raw ids (requesterEmployeeId, requesterShiftId,
 * targetEmployeeId, targetShiftId, state, …); this UI wants human labels + names. The ENRICHMENT
 * layer below resolves those ids against `/api/employees` (id → "First Last") and `/api/grafik/shifts`
 * (id → "pon 13.07 · 06:00–14:00 · ROLE") to project each backend row onto the {@link SwapRequest}
 * shape the component renders.
 *
 * Synthetic data only (RODO): no PESEL, no real people.
 */

/** Lifecycle states — parity with the tenant `SwapState` enum + `swap-state-machine.ts`. */
export type SwapState =
  | 'DRAFT'
  | 'PENDING_PEER'
  | 'PEER_AGREED'
  | 'PENDING_MANAGER'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'

export const TERMINAL_STATES: SwapState[] = ['APPROVED', 'REJECTED', 'CANCELLED']

export interface ShiftRef {
  /** Short human label for the shift window (the real API returns ids; the grid resolves labels). */
  label: string
  employeeName: string
}

export interface SwapRequest {
  id: string
  state: SwapState
  requester: ShiftRef
  /** Null for a "give away" request (no counterparty). */
  target: ShiftRef | null
  /** The caller's relationship to this request — drives which actions the UI offers. */
  mineRole: 'requester' | 'target' | null
  unit: string
  createdAt: string
}

/** Polish labels for each state, for badges/legends. */
export const STATE_LABEL: Record<SwapState, string> = {
  DRAFT: 'Szkic',
  PENDING_PEER: 'Czeka na współpracownika',
  PEER_AGREED: 'Zaakceptowana przez współpracownika',
  PENDING_MANAGER: 'Czeka na managera',
  APPROVED: 'Zatwierdzona',
  REJECTED: 'Odrzucona',
  CANCELLED: 'Anulowana',
}

export interface ListFilter {
  state?: SwapState
  mine?: boolean
}

// --- backend row shape + HTTP plumbing -----------------------------------------------------------

/** A raw `ShiftSwapRequest` row as returned by the tenant-runtime list/mutation endpoints (ids only). */
interface BackendSwapRow {
  id: string
  requesterEmployeeId: string
  requesterShiftId: string
  targetEmployeeId: string | null
  targetShiftId: string | null
  state: SwapState
  reason: string | null
  decidedByManagerId: string | null
  createdAt: string
  updatedAt: string
}

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 502 (down). */
export class SwapApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SwapApiError'
  }
}

async function swapFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new SwapApiError(res.status, humanizeError(res.status, detail) || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Surface the backend's `message` (NestJS error body) rather than a raw JSON blob. */
function humanizeError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] }
    const msg = Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message
    if (msg) return msg
  } catch {
    /* fall through to the raw body */
  }
  return body
}

// --- enrichment: backend ids → UI labels/names ---------------------------------------------------

interface EmployeeLite {
  id: string
  firstName: string
  lastName: string
  unitId: string
}
interface ShiftLite {
  id: string
  employeeId: string
  date: string
  start: string
  end: string
  role: string
}

/** id → resolvers, built once per enrichment pass from the roster + the week's shifts. */
interface EnrichMaps {
  empName: Map<string, string>
  shiftLabel: Map<string, string>
  shiftRole: Map<string, string>
}

const WEEKDAY_SHORT_PL = ['nd', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'] as const

/** "pon 13.07 · 06:00–14:00 · RECEPCJA" from a shift row (date is UTC `YYYY-MM-DD[...]`). */
function shiftLabelOf(s: ShiftLite): string {
  const iso = s.date.slice(0, 10)
  const d = new Date(`${iso}T00:00:00.000Z`)
  const wd = WEEKDAY_SHORT_PL[d.getUTCDay()]
  const dd = iso.slice(8, 10)
  const mm = iso.slice(5, 7)
  return `${wd} ${dd}.${mm} · ${s.start}–${s.end} · ${s.role}`
}

/** Fetch the roster + shifts once (same-origin proxy) and build the id→label / id→name maps. */
async function buildEnrichMaps(): Promise<EnrichMaps> {
  const [emps, shifts] = await Promise.all([
    swapFetch<EmployeeLite[]>('/api/employees'),
    swapFetch<ShiftLite[]>('/api/grafik/shifts'),
  ])
  const empName = new Map<string, string>()
  for (const e of emps) empName.set(e.id, `${e.firstName} ${e.lastName}`.trim())
  const shiftLabel = new Map<string, string>()
  const shiftRole = new Map<string, string>()
  for (const s of shifts) {
    shiftLabel.set(s.id, shiftLabelOf(s))
    shiftRole.set(s.id, s.role)
  }
  return { empName, shiftLabel, shiftRole }
}

/** Project a raw backend row onto the {@link SwapRequest} shape the component renders. */
function enrichRow(row: BackendSwapRow, maps: EnrichMaps): SwapRequest {
  const requester: ShiftRef = {
    label: maps.shiftLabel.get(row.requesterShiftId) ?? row.requesterShiftId.slice(0, 8),
    employeeName: maps.empName.get(row.requesterEmployeeId) ?? row.requesterEmployeeId.slice(0, 8),
  }
  const target: ShiftRef | null =
    row.targetShiftId && row.targetEmployeeId
      ? {
          label: maps.shiftLabel.get(row.targetShiftId) ?? row.targetShiftId.slice(0, 8),
          employeeName: maps.empName.get(row.targetEmployeeId) ?? row.targetEmployeeId.slice(0, 8),
        }
      : null
  return {
    id: row.id,
    state: row.state,
    requester,
    target,
    // No "current employee" endpoint yet, so we cannot tell whether the caller is the requester or
    // the target of a row. The demo user (ADMIN_KLIENTA) has no Employee record, so the `mine=true`
    // list is empty and this is moot; a worker view would need a `/me` resolver to populate this.
    mineRole: null,
    // The backend row has no department name; the requester shift's job role is the most meaningful
    // human label available for the "Jednostka" column.
    unit: maps.shiftRole.get(row.requesterShiftId) ?? '—',
    createdAt: row.createdAt.slice(0, 10),
  }
}

async function enrichRows(rows: BackendSwapRow[]): Promise<SwapRequest[]> {
  if (rows.length === 0) return []
  const maps = await buildEnrichMaps()
  return rows.map((r) => enrichRow(r, maps))
}

// --- swapApi: real fetch against /api/shift-swap/* -----------------------------------------------

/**
 * The swap API the polling UI talks to — now REAL same-origin `fetch` calls to the tenant-runtime
 * proxy, with backend ids enriched to labels/names. The surface (list/create/submit/peerDecision/
 * submitToManager/managerDecision/cancel) is unchanged so the component keeps working. The backend
 * state machine + RBAC (D1/D2) have the final say; illegal transitions surface as SwapApiError.
 */
export const swapApi = {
  async list(filter: ListFilter = {}): Promise<SwapRequest[]> {
    const qs = new URLSearchParams()
    if (filter.state) qs.set('state', filter.state)
    if (filter.mine) qs.set('mine', 'true')
    const query = qs.toString()
    const rows = await swapFetch<BackendSwapRow[]>(`/api/shift-swap${query ? `?${query}` : ''}`)
    return enrichRows(rows)
  },

  /** Create a DRAFT swap. Backend contract: the requester shift MUST belong to the caller's Employee. */
  async create(input: { requesterShiftId: string; targetShiftId?: string }): Promise<SwapRequest> {
    const row = await swapFetch<BackendSwapRow>('/api/shift-swap', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return enrichRow(row, await buildEnrichMaps())
  },

  async submit(id: string): Promise<SwapRequest> {
    const row = await swapFetch<BackendSwapRow>(`/api/shift-swap/${id}/submit`, { method: 'POST' })
    return enrichRow(row, await buildEnrichMaps())
  },

  async peerDecision(id: string, accept: boolean): Promise<SwapRequest> {
    const row = await swapFetch<BackendSwapRow>(`/api/shift-swap/${id}/peer-decision`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    })
    return enrichRow(row, await buildEnrichMaps())
  },

  async submitToManager(id: string): Promise<SwapRequest> {
    const row = await swapFetch<BackendSwapRow>(`/api/shift-swap/${id}/submit-to-manager`, {
      method: 'POST',
    })
    return enrichRow(row, await buildEnrichMaps())
  },

  /** PENDING_MANAGER → APPROVED (approve) / REJECTED. On approve the backend atomically reassigns shifts. */
  async managerDecision(id: string, approve: boolean): Promise<SwapRequest> {
    const row = await swapFetch<BackendSwapRow>(`/api/shift-swap/${id}/manager-decision`, {
      method: 'POST',
      body: JSON.stringify({ approve }),
    })
    return enrichRow(row, await buildEnrichMaps())
  },

  async cancel(id: string): Promise<SwapRequest> {
    const row = await swapFetch<BackendSwapRow>(`/api/shift-swap/${id}/cancel`, { method: 'POST' })
    return enrichRow(row, await buildEnrichMaps())
  },
}
