/**
 * SP4 "koszty" (cost) client model for the web-kit UAT surface.
 *
 * LIVE: `kosztyApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js proxy at
 * `/api/koszty/*` (see app/api/koszty/[[...path]] + lib/tenant-runtime.ts), which forwards to the
 * NestJS `GET/PATCH /koszty/rates` + `GET /koszty/week` endpoints (apps/tenant-runtime/src/cost/
 * cost.controller.ts) with a cookie-resolved Keycloak bearer.
 *
 * RBAC mirrors the backend exactly (Codex P1-1): rate/budget WRITES are HR/ADMIN_KLIENTA only — this
 * client never assumes a MANAGER can PATCH rates, and the UI must gate the rate-editing form the same
 * way (see components/ai-grafik/cost-panel.tsx). Reads (GET rates / GET week) are open to
 * MANAGER/HR/ADMIN_KLIENTA; a MANAGER's `getWeek` call MUST pass a `unitId` — the backend 403s
 * otherwise (Codex P1-3).
 *
 * A missing rate is NEVER rendered as "0 zł" (Codex Open-Q missing rate) — every money formatter here
 * takes `string | number | null` and renders `null` as the Polish "brak stawki" string. The pure
 * helpers (formatMoney/formatCostDelta/budgetAlertTone/budgetAlertText) are exported separately so the
 * cost panel and the unit tests share one source of truth.
 */

import { EMPLOYMENT_TYPES, type EmploymentType } from './employee-profile'

export { EMPLOYMENT_TYPES }
export type { EmploymentType }

/** Text shown wherever a cost figure is unknown because a rate is missing — NEVER "0 zł". */
export const BRAK_STAWKI = 'brak stawki'

/** A persisted standard hourly cost rate for a (position, employmentType) pair (`PositionCostRate`). */
export interface CostRate {
  id: string
  position: string
  employmentType: EmploymentType
  /** Prisma Decimal serializes as a string over JSON. */
  hourlyRate: string | number
  /** Stored for a future phase; the MVP calculator never reads or applies this (Codex P1-4). */
  overtimeMultiplier: string | number
  currency: string
  createdAt?: string
  updatedAt?: string
}

/** `PATCH /koszty/rates` body — HR/ADMIN_KLIENTA only. */
export interface UpsertRateInput {
  position: string
  employmentType: EmploymentType
  hourlyRate: number
  currency?: string
}

/** A (position, employmentType) pair with no matching {@link CostRate} in scope. */
export interface MissingRate {
  position: string
  employmentType: EmploymentType
  employeeIds: string[]
}

/** `GET /koszty/week` result shape shared by {@link WeekCostResult}/{@link BudgetStatusResult}. */
export interface WeekCostResult {
  cost: string | null
  currency: string | null
  missingRates: MissingRate[]
  currencyConflict: boolean
}

/** Full `GET /koszty/week` response: week cost + the effective budget-cap comparison. */
export interface BudgetStatusResult extends WeekCostResult {
  cap: string | null
  overBudget: boolean | null
}

/** Params for {@link kosztyApi.getWeek}. `unitId` is required for a MANAGER caller (Codex P1-3). */
export interface GetWeekParams {
  /** Any `YYYY-MM-DD` date inside the target ISO week. */
  weekStart: string
  unitId?: string
}

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 502 (down). */
export class KosztyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'KosztyApiError'
  }
}

async function kosztyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new KosztyApiError(res.status, humanizeError(detail) || res.statusText)
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

export const kosztyApi = {
  /** All persisted rates. Reads: MANAGER/HR/ADMIN_KLIENTA. */
  getRates(): Promise<CostRate[]> {
    return kosztyFetch<CostRate[]>('/api/koszty/rates')
  },

  /** Create-or-update a standard hourly rate. Writes: HR/ADMIN_KLIENTA only (Codex P1-1). */
  updateRates(input: UpsertRateInput): Promise<CostRate> {
    return kosztyFetch<CostRate>('/api/koszty/rates', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },

  /** Week cost + budget status + missingRates for a unit (manager) or tenant-wide (HR/ADMIN, no unitId). */
  getWeek(params: GetWeekParams): Promise<BudgetStatusResult> {
    const qs = new URLSearchParams({ weekStart: params.weekStart })
    if (params.unitId) qs.set('unitId', params.unitId)
    return kosztyFetch<BudgetStatusResult>(`/api/koszty/week?${qs.toString()}`)
  },
}

// --- pure formatters/calculators (shared by cost-panel.tsx + koszty.test.ts) -----------------------

const PLN_FORMATTER = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Format a money amount for display. `null` (a missing rate, a currency conflict, or "no shifts yet
 * summed") ALWAYS renders as {@link BRAK_STAWKI} — NEVER "0 zł" (Codex Open-Q missing rate). A
 * currency other than PLN is suffixed with its raw code instead of "zł".
 */
export function formatMoney(amount: string | number | null | undefined, currency: string | null = 'PLN'): string {
  if (amount === null || amount === undefined) return BRAK_STAWKI
  const n = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(n)) return BRAK_STAWKI
  const formatted = PLN_FORMATTER.format(n)
  const unit = !currency || currency === 'PLN' ? 'zł' : currency
  return `${formatted} ${unit}`
}

/**
 * Format an AI proposal's Δcost (`AiProposal.estimatedCost`) with an explicit sign: a positive delta
 * (candidate costlier than the vacated employee) gets a leading "+", a negative delta (a saving) keeps
 * its own "-" from the formatted number. `null` — either side's rate was missing when the proposal was
 * created — is {@link BRAK_STAWKI}, never "+0,00 zł" (Codex P2-2).
 */
export function formatCostDelta(value: string | number | null | undefined, currency: string | null = 'PLN'): string {
  if (value === null || value === undefined) return BRAK_STAWKI
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return BRAK_STAWKI
  const sign = n > 0 ? '+' : ''
  return `${sign}${formatMoney(n, currency)}`
}

/** Visual tone for the budget-cap alert, keyed to {@link BudgetStatusResult.overBudget}'s tri-state. */
export type BudgetTone = 'ok' | 'warn' | 'muted'

/**
 * `overBudget === true` → 'warn' (over cap); `false` → 'ok' (within cap); `null` → 'muted' — the
 * comparison could not be honestly asserted (currency conflict or a missing rate that could still tip
 * the real total over the cap), so the UI must NOT claim "OK" (Codex Open-Q missing rate).
 */
export function budgetAlertTone(status: Pick<BudgetStatusResult, 'overBudget'>): BudgetTone {
  if (status.overBudget === true) return 'warn'
  if (status.overBudget === false) return 'ok'
  return 'muted'
}

/**
 * Polish sentence for the budget-cap alert banner. Currency conflicts and missing rates each get their
 * own explicit copy (never folded into a generic "unknown") so the manager understands WHY the budget
 * status can't be asserted; a "no cap configured" status is distinct from "within cap".
 */
export function budgetAlertText(status: BudgetStatusResult): string {
  if (status.currencyConflict) {
    return 'Nie można zsumować kosztu — zmiany w tym zakresie mają stawki w różnych walutach.'
  }
  if (status.cap === null) {
    return 'Brak ustawionego limitu budżetu dla tego zakresu.'
  }
  if (status.overBudget === true) {
    return `Przekroczono limit budżetu tygodniowego (${formatMoney(status.cap, status.currency)}).`
  }
  if (status.missingRates.length > 0) {
    return 'Część zmian nie ma przypisanej stawki — rzeczywisty koszt może być wyższy niż pokazany.'
  }
  return `W ramach limitu budżetu tygodniowego (${formatMoney(status.cap, status.currency)}).`
}
