/**
 * Shift-swap client model for the web-kit UAT surface.
 *
 * PROOF-OF-STACK: this is an in-memory stand-in for the tenant-runtime REST API
 * (`POST /shift-swap`, `/:id/submit`, `/:id/peer-decision`, `/:id/submit-to-manager`,
 * `/:id/manager-decision`, `/:id/cancel`, `GET /shift-swap?state=&mine=` — see
 * `apps/tenant-runtime/src/shift-swap`). It mirrors the D1 state machine + D2 RBAC so the polling
 * UI can be exercised without a live backend + Keycloak token; swap `swapApi` for real `fetch(...)`
 * calls once the grafik grid + tenant auth land (the propose-swap hook comes from the grid).
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

// --- in-memory store (proof-of-stack) ------------------------------------------------------------

let seq = 100
function seed(): SwapRequest[] {
  return [
    {
      id: 'swap-1',
      state: 'DRAFT',
      requester: { label: 'pon 13.07 · 06:00–14:00 · Produkcja', employeeName: 'Jan Kowalski' },
      target: { label: 'wt 14.07 · 06:00–14:00 · Produkcja', employeeName: 'Piotr Wiśniewski' },
      mineRole: 'requester',
      unit: 'Produkcja',
      createdAt: '2026-07-09',
    },
    {
      id: 'swap-2',
      state: 'PENDING_PEER',
      requester: { label: 'śr 15.07 · 14:00–22:00 · Logistyka', employeeName: 'Marek Zieliński' },
      target: { label: 'czw 16.07 · 14:00–22:00 · Logistyka', employeeName: 'Jan Kowalski' },
      mineRole: 'target',
      unit: 'Logistyka',
      createdAt: '2026-07-08',
    },
    {
      id: 'swap-3',
      state: 'PENDING_MANAGER',
      requester: { label: 'pt 17.07 · 06:00–14:00 · Produkcja', employeeName: 'Anna Nowak' },
      target: { label: 'sob 18.07 · 06:00–14:00 · Produkcja', employeeName: 'Tomasz Kamiński' },
      mineRole: null,
      unit: 'Produkcja',
      createdAt: '2026-07-08',
    },
    {
      id: 'swap-4',
      state: 'APPROVED',
      requester: { label: 'pon 06.07 · 22:00–06:00 · Produkcja', employeeName: 'Jan Kowalski' },
      target: { label: 'wt 07.07 · 22:00–06:00 · Produkcja', employeeName: 'Anna Nowak' },
      mineRole: 'requester',
      unit: 'Produkcja',
      createdAt: '2026-07-05',
    },
  ]
}

let STORE: SwapRequest[] = seed()

const clone = (r: SwapRequest): SwapRequest => ({ ...r, requester: { ...r.requester }, target: r.target ? { ...r.target } : null })
const find = (id: string): SwapRequest => {
  const r = STORE.find((s) => s.id === id)
  if (!r) throw new Error(`swap ${id} not found`)
  return r
}

export interface ListFilter {
  state?: SwapState
  mine?: boolean
}

/**
 * The swap "API" the polling UI talks to. Async + latency-shaped so it reads like the eventual
 * `fetch('/api/shift-swap')`. Mutations enforce the same legal transitions as the backend machine.
 */
export const swapApi = {
  async list(filter: ListFilter = {}): Promise<SwapRequest[]> {
    let rows = STORE.map(clone)
    if (filter.mine) rows = rows.filter((r) => r.mineRole !== null)
    if (filter.state) rows = rows.filter((r) => r.state === filter.state)
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  async create(input: { requester: ShiftRef; target: ShiftRef | null; unit: string }): Promise<SwapRequest> {
    const row: SwapRequest = {
      id: `swap-${++seq}`,
      state: 'DRAFT',
      requester: input.requester,
      target: input.target,
      mineRole: 'requester',
      unit: input.unit,
      createdAt: '2026-07-09',
    }
    STORE = [row, ...STORE]
    return clone(row)
  },

  async submit(id: string): Promise<SwapRequest> {
    const r = find(id)
    if (r.state !== 'DRAFT') throw new Error('only a DRAFT may be submitted')
    r.state = 'PENDING_PEER'
    return clone(r)
  },

  async peerDecision(id: string, accept: boolean): Promise<SwapRequest> {
    const r = find(id)
    if (r.state !== 'PENDING_PEER') throw new Error('not awaiting peer')
    r.state = accept ? 'PEER_AGREED' : 'REJECTED'
    return clone(r)
  },

  async submitToManager(id: string): Promise<SwapRequest> {
    const r = find(id)
    if (r.state !== 'PEER_AGREED') throw new Error('peer has not agreed')
    r.state = 'PENDING_MANAGER'
    return clone(r)
  },

  async managerDecision(id: string, approve: boolean): Promise<SwapRequest> {
    const r = find(id)
    if (r.state !== 'PENDING_MANAGER') throw new Error('not awaiting manager')
    // On approve the backend runs the optimizer feasibility check (H1–H4) before swapping shifts.
    r.state = approve ? 'APPROVED' : 'REJECTED'
    return clone(r)
  },

  async cancel(id: string): Promise<SwapRequest> {
    const r = find(id)
    if (TERMINAL_STATES.includes(r.state)) throw new Error('already terminal')
    r.state = 'CANCELLED'
    return clone(r)
  },
}
