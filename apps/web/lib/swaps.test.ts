import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STATE_LABEL,
  SwapApiError,
  TERMINAL_STATES,
  computeMineRole,
  swapApi,
  type SwapState,
} from './swaps'

/**
 * Client-seam coverage for the Zamiany (shift-swap) wiring [backlog UI-1].
 *
 * The J5 journey — zgłoszenie → akceptacja peera → akceptacja managera, plus odrzucenie przy
 * złamaniu reguł — is asserted here at the HTTP seam: every `swapApi` call must hit the right
 * `/api/shift-swap/*` endpoint with the right method/body, and must project the backend's id-only
 * rows onto the labelled shape the grid renders. The live round-trip through Postgres/Keycloak is
 * CI-5's Playwright smoke; this file is what runs on every push with no services up.
 *
 * The backend state machine is authoritative — these tests never simulate a transition locally,
 * they replay what the server returned and assert the client faithfully relays it.
 */

// --- fixture roster + shifts the enrichment layer resolves ids against -----------------------------

const EMPLOYEES = [
  { id: 'emp-anna', firstName: 'Anna', lastName: 'Kowalska', unitId: 'unit-1' },
  { id: 'emp-piotr', firstName: 'Piotr', lastName: 'Nowak', unitId: 'unit-1' },
]

const SHIFTS = [
  // 2026-07-13 is a Monday.
  { id: 'sh-a', employeeId: 'emp-anna', date: '2026-07-13', start: '06:00', end: '14:00', role: 'RECEPCJA' },
  { id: 'sh-p', employeeId: 'emp-piotr', date: '2026-07-15', start: '14:00', end: '22:00', role: 'SERWIS' },
]

/** A raw backend row (ids only) in the given state. */
function row(state: SwapState, over: Record<string, unknown> = {}) {
  return {
    id: 'swap-1',
    requesterEmployeeId: 'emp-anna',
    requesterShiftId: 'sh-a',
    targetEmployeeId: 'emp-piotr',
    targetShiftId: 'sh-p',
    state,
    reason: null,
    decidedByManagerId: null,
    createdAt: '2026-07-11T09:30:00.000Z',
    updatedAt: '2026-07-11T09:30:00.000Z',
    ...over,
  }
}

interface Call {
  url: string
  method: string
  body: unknown
}

let calls: Call[]

/** Install a fetch stub that serves the enrichment endpoints and returns `swapBody` for swap calls. */
function stubFetch(swapResponder: (url: string) => { status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    if (url === '/api/employees') return jsonRes(200, EMPLOYEES)
    if (url === '/api/grafik/shifts') return jsonRes(200, SHIFTS)
    const { status = 200, body } = swapResponder(url)
    return jsonRes(status, body)
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

/** The swap calls only — enrichment traffic filtered out, so assertions stay readable. */
function swapCalls() {
  return calls.filter((c) => c.url.startsWith('/api/shift-swap'))
}

const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

// --- state vocabulary ------------------------------------------------------------------------------

describe('state vocabulary', () => {
  it('labels every lifecycle state in Polish', () => {
    const states: SwapState[] = [
      'DRAFT',
      'PENDING_PEER',
      'PEER_AGREED',
      'PENDING_MANAGER',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
    ]
    for (const s of states) {
      expect(STATE_LABEL[s], `missing label for ${s}`).toBeTruthy()
    }
    expect(Object.keys(STATE_LABEL)).toHaveLength(states.length)
  })

  it('treats exactly the three end-of-life states as terminal', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['APPROVED', 'CANCELLED', 'REJECTED'])
    // A swap still awaiting a decision must never be terminal — the UI stops polling on terminal.
    expect(TERMINAL_STATES).not.toContain('PENDING_MANAGER')
    expect(TERMINAL_STATES).not.toContain('PENDING_PEER')
  })
})

// --- list + enrichment -----------------------------------------------------------------------------

describe('swapApi.list', () => {
  it('resolves backend ids to human labels and names', async () => {
    stubFetch(() => ({ body: [row('PENDING_PEER')] }))

    const [swap] = await swapApi.list()

    expect(swap.id).toBe('swap-1')
    expect(swap.state).toBe('PENDING_PEER')
    expect(swap.requester.employeeName).toBe('Anna Kowalska')
    expect(swap.requester.label).toBe('pon 13.07 · 06:00–14:00 · RECEPCJA')
    expect(swap.target?.employeeName).toBe('Piotr Nowak')
    expect(swap.target?.label).toBe('śr 15.07 · 14:00–22:00 · SERWIS')
    // "Jednostka" column falls back to the requester shift's job role.
    expect(swap.unit).toBe('RECEPCJA')
    expect(swap.createdAt).toBe('2026-07-11')
  })

  it('passes state and mine filters through as query params', async () => {
    stubFetch(() => ({ body: [] }))

    await swapApi.list({ state: 'PENDING_MANAGER', mine: true })

    expect(swapCalls()[0].url).toBe('/api/shift-swap?state=PENDING_MANAGER&mine=true')
  })

  it('omits the query string entirely when unfiltered', async () => {
    stubFetch(() => ({ body: [] }))

    await swapApi.list()

    expect(swapCalls()[0].url).toBe('/api/shift-swap')
  })

  it('skips the enrichment round-trip when there are no rows', async () => {
    const fn = stubFetch(() => ({ body: [] }))

    const out = await swapApi.list()

    expect(out).toEqual([])
    // Only the list call — no /api/employees, no /api/grafik/shifts.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('models a give-away request (no counterparty) as a null target', async () => {
    stubFetch(() => ({
      body: [row('PENDING_MANAGER', { targetEmployeeId: null, targetShiftId: null })],
    }))

    const [swap] = await swapApi.list()

    expect(swap.target).toBeNull()
    expect(swap.requester.employeeName).toBe('Anna Kowalska')
  })

  it('degrades to a truncated id when an id is not in the roster/shift maps', async () => {
    stubFetch(() => ({
      body: [
        row('PENDING_PEER', {
          requesterEmployeeId: 'emp-unknown-0123456789',
          requesterShiftId: 'sh-unknown-0123456789',
        }),
      ],
    }))

    const [swap] = await swapApi.list()

    // Falls back to the first 8 chars rather than rendering "undefined".
    expect(swap.requester.employeeName).toBe('emp-unkn')
    expect(swap.requester.label).toBe('sh-unkno')
    expect(swap.unit).toBe('—')
  })
})

// --- J5: zgłoszenie → peer → manager ---------------------------------------------------------------

describe('J5 happy path — zgłoszenie → akceptacja peera → akceptacja managera', () => {
  it('walks the whole journey, hitting the correct endpoint at each step', async () => {
    // The server drives the state; the stub replays the transition the backend would make.
    const byUrl: Record<string, SwapState> = {
      '/api/shift-swap': 'DRAFT',
      '/api/shift-swap/swap-1/submit': 'PENDING_PEER',
      '/api/shift-swap/swap-1/peer-decision': 'PEER_AGREED',
      '/api/shift-swap/swap-1/submit-to-manager': 'PENDING_MANAGER',
      '/api/shift-swap/swap-1/manager-decision': 'APPROVED',
    }
    stubFetch((url) => ({ body: row(byUrl[url]) }))

    const created = await swapApi.create({ requesterShiftId: 'sh-a', targetShiftId: 'sh-p' })
    expect(created.state).toBe('DRAFT')

    expect((await swapApi.submit('swap-1')).state).toBe('PENDING_PEER')
    expect((await swapApi.peerDecision('swap-1', true)).state).toBe('PEER_AGREED')
    expect((await swapApi.submitToManager('swap-1')).state).toBe('PENDING_MANAGER')

    const approved = await swapApi.managerDecision('swap-1', true)
    expect(approved.state).toBe('APPROVED')
    expect(TERMINAL_STATES).toContain(approved.state)

    expect(swapCalls()).toEqual([
      {
        url: '/api/shift-swap',
        method: 'POST',
        body: { requesterShiftId: 'sh-a', targetShiftId: 'sh-p' },
      },
      { url: '/api/shift-swap/swap-1/submit', method: 'POST', body: undefined },
      { url: '/api/shift-swap/swap-1/peer-decision', method: 'POST', body: { accept: true } },
      { url: '/api/shift-swap/swap-1/submit-to-manager', method: 'POST', body: undefined },
      { url: '/api/shift-swap/swap-1/manager-decision', method: 'POST', body: { approve: true } },
    ])
  })

  it('sends accept:false for a peer refusal and relays the resulting REJECTED', async () => {
    stubFetch(() => ({ body: row('REJECTED') }))

    const out = await swapApi.peerDecision('swap-1', false)

    expect(out.state).toBe('REJECTED')
    expect(swapCalls()[0].body).toEqual({ accept: false })
  })

  it('sends approve:false for a manager refusal and relays the resulting REJECTED', async () => {
    stubFetch(() => ({ body: row('REJECTED') }))

    const out = await swapApi.managerDecision('swap-1', false)

    expect(out.state).toBe('REJECTED')
    expect(swapCalls()[0].body).toEqual({ approve: false })
  })

  it('cancels via the dedicated endpoint', async () => {
    stubFetch(() => ({ body: row('CANCELLED') }))

    const out = await swapApi.cancel('swap-1')

    expect(out.state).toBe('CANCELLED')
    expect(swapCalls()[0]).toEqual({
      url: '/api/shift-swap/swap-1/cancel',
      method: 'POST',
      body: undefined,
    })
  })

  it('omits targetShiftId from the create body for a give-away', async () => {
    stubFetch(() => ({ body: row('DRAFT', { targetEmployeeId: null, targetShiftId: null }) }))

    await swapApi.create({ requesterShiftId: 'sh-a' })

    expect(swapCalls()[0].body).toEqual({ requesterShiftId: 'sh-a' })
  })
})

// --- odrzucenie przy złamaniu reguł ----------------------------------------------------------------

describe('rule violations surface as SwapApiError', () => {
  it('relays the backend message when the swap breaks a hard rule (409)', async () => {
    stubFetch(() => ({
      status: 409,
      body: { statusCode: 409, message: 'Zamiana narusza H4: odpoczynek dobowy < 11h' },
    }))

    await expect(swapApi.managerDecision('swap-1', true)).rejects.toThrowError(SwapApiError)
    await expect(swapApi.managerDecision('swap-1', true)).rejects.toMatchObject({
      status: 409,
      message: 'Zamiana narusza H4: odpoczynek dobowy < 11h',
    })
  })

  it('joins the array form of a NestJS validation message', async () => {
    stubFetch(() => ({
      status: 400,
      body: { statusCode: 400, message: ['requesterShiftId must be a UUID', 'accept must be a boolean'] },
    }))

    await expect(swapApi.create({ requesterShiftId: 'nope' })).rejects.toMatchObject({
      status: 400,
      message: 'requesterShiftId must be a UUID; accept must be a boolean',
    })
  })

  it('preserves 401 and 403 so the UI can tell auth from RBAC', async () => {
    stubFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }))
    await expect(swapApi.list()).rejects.toMatchObject({ status: 401 })

    stubFetch(() => ({ status: 403, body: { message: 'Wymagana rola MANAGER' } }))
    await expect(swapApi.managerDecision('swap-1', true)).rejects.toMatchObject({
      status: 403,
      message: 'Wymagana rola MANAGER',
    })
  })

  it('rejects an illegal transition the backend refuses (state machine is authoritative)', async () => {
    // Client-side there is nothing stopping managerDecision on a DRAFT — the server must say no,
    // and that refusal has to reach the user rather than being swallowed.
    stubFetch(() => ({
      status: 409,
      body: { message: 'Nieprawidłowe przejście: DRAFT → APPROVED' },
    }))

    await expect(swapApi.managerDecision('swap-1', true)).rejects.toMatchObject({
      status: 409,
      message: 'Nieprawidłowe przejście: DRAFT → APPROVED',
    })
  })

  it('falls back to the raw body when the error payload is not JSON', async () => {
    stubFetch(() => ({ status: 502, body: 'Bad Gateway: tenant-runtime unreachable' }))

    await expect(swapApi.list()).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway: tenant-runtime unreachable',
    })
  })
})

describe('computeMineRole (G3 — peer-flow reachability)', () => {
  const row = { requesterEmployeeId: 'emp-A', targetEmployeeId: 'emp-B' }

  it("is 'requester' when the caller raised the swap", () => {
    expect(computeMineRole(row, 'emp-A')).toBe('requester')
  })

  it("is 'target' when the caller is the counterparty", () => {
    expect(computeMineRole(row, 'emp-B')).toBe('target')
  })

  it('is null for an unrelated employee', () => {
    expect(computeMineRole(row, 'emp-C')).toBeNull()
  })

  it('is null when the caller has no employee identity (e.g. admin without /me)', () => {
    expect(computeMineRole(row, null)).toBeNull()
  })

  it('is null (not target) when there is no counterparty', () => {
    expect(computeMineRole({ requesterEmployeeId: 'emp-A', targetEmployeeId: null }, 'emp-B')).toBeNull()
  })
})
