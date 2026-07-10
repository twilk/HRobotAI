// Grafik data layer — types mirroring the tenant-runtime grafik API (A3 CRUD + A4 /solve),
// pure week/date helpers (unit-tested in grafik.test.ts), and the browser-side client that
// talks to the LOCAL Next.js proxy routes under /api/grafik/* + /api/employees.
//
// The proxy (see lib/tenant-runtime.ts + app/api/**) forwards these to the real NestJS backend
// with the caller's Keycloak bearer token — there is no mock data here.

// --- Types (mirror packages/db Prisma models + packages/shared grafik contract) -----------------

export type ShiftSource = 'AUTO' | 'MANUAL'
export type DemandSource = 'TEMPLATE' | 'MANUAL'
export type SolveStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE'

/** A persisted assignment. Dates arrive as `@db.Date` (JSON `YYYY-MM-DD...`); use isoDate() to key. */
export interface Shift {
  id: string
  employeeId: string
  lokalizacjaId: string
  demandId: string | null
  date: string
  start: string // HH:mm
  end: string // HH:mm
  role: string
  source: ShiftSource
}

/** A staffing requirement for a location/day — the thing the solver tries to cover. */
export interface ShiftDemand {
  id: string
  lokalizacjaId: string
  date: string
  start: string
  end: string
  requiredRole: string
  requiredCount: number
  source: DemandSource
}

/** Roster row. `pesel`/email are never returned by the API (RODO) — names only. */
export interface Employee {
  id: string
  firstName: string
  lastName: string
  position: string | null
  unitId: string
}

/** A demand the solver could not (fully) staff — surfaced verbatim from the contract. */
export interface Unmet {
  demandId: string
  reason: string
}

/** Shape returned by POST /grafik/solve (SolveGrafikResult in the backend service). */
export interface SolveResult {
  status: SolveStatus
  assignmentsCreated: number
  unmet: Unmet[]
  metrics: { commuteTotal: number; etatDeviation: number; fairnessScore: number }
  shifts: Shift[]
}

export interface CreateShiftInput {
  employeeId: string
  lokalizacjaId: string
  date: string // YYYY-MM-DD
  start: string // HH:mm
  end: string // HH:mm
  role: string
  demandId?: string
  source?: ShiftSource
}

export type UpdateShiftInput = Partial<CreateShiftInput>

export interface SolveInput {
  weekStart: string // Monday, YYYY-MM-DD
  unitId?: string
  lokalizacjaIds?: string[]
}

// --- Date helpers (pure; UTC throughout to avoid TZ drift on @db.Date boundaries) ---------------

/** `YYYY-MM-DD` for a Date, in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Normalise an API date (`2026-07-06` or `2026-07-06T00:00:00.000Z`) to `YYYY-MM-DD`. */
export function normalizeDate(value: string): string {
  return value.slice(0, 10)
}

/** Monday 00:00 UTC of the ISO week containing `date` (weeks start Monday, per the solver horizon). */
export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun … 6=Sat
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return d
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

/** The 7 ISO dates Mon→Sun of the week starting at `mondayIso`. */
export function weekDates(mondayIso: string): string[] {
  const start = new Date(`${mondayIso}T00:00:00.000Z`)
  return Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)))
}

/** Shift a Monday ISO date by ±1 week. */
export function shiftWeek(mondayIso: string, deltaWeeks: number): string {
  return isoDate(addDays(new Date(`${mondayIso}T00:00:00.000Z`), deltaWeeks * 7))
}

export const WEEKDAY_LABELS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'] as const

const MONTHS_PL = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
] as const

/** Day-of-month for an ISO date (grid column subheader). */
export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10))
}

/** e.g. "6–12 lipca 2026" (collapses month/year when shared across the span). */
export function formatWeekRange(mondayIso: string): string {
  const dates = weekDates(mondayIso)
  const first = new Date(`${dates[0]}T00:00:00.000Z`)
  const last = new Date(`${dates[6]}T00:00:00.000Z`)
  const d1 = first.getUTCDate()
  const d2 = last.getUTCDate()
  const m1 = first.getUTCMonth()
  const m2 = last.getUTCMonth()
  const y1 = first.getUTCFullYear()
  const y2 = last.getUTCFullYear()
  if (y1 !== y2) return `${d1} ${MONTHS_PL[m1]} ${y1} – ${d2} ${MONTHS_PL[m2]} ${y2}`
  if (m1 !== m2) return `${d1} ${MONTHS_PL[m1]} – ${d2} ${MONTHS_PL[m2]} ${y1}`
  return `${d1}–${d2} ${MONTHS_PL[m1]} ${y1}`
}

/** Short "Anna N." style label for a shift chip; falls back to the raw id. */
export function shortName(e: Employee | undefined, employeeId: string): string {
  if (!e) return employeeId.slice(0, 8)
  const initial = e.lastName ? ` ${e.lastName.charAt(0)}.` : ''
  return `${e.firstName}${initial}`
}

// --- Solve metrics derivations (pure; unit-tested in grafik.test.ts) -----------------------------
//
// The J3 metrics strip surfaces the aggregate figures a SolveResult already carries, plus two
// values derived client-side from data already in the view. `fairnessScore` is deliberately NOT
// surfaced — it is an M3 placeholder (always 0) and would mislead 4Mobility, so it is absent from
// `deriveGrafikMetrics` output by design (asserted by the test).

/** Duration of one shift in hours, from its `HH:mm` start/end. Never negative (clamps to 0). */
export function shiftDurationHours(shift: Pick<Shift, 'start' | 'end'>): number {
  const mins = hhmmToMinutes(shift.end) - hhmmToMinutes(shift.start)
  return mins > 0 ? mins / 60 : 0
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

/** Commute minutes → human-readable, Polish. 0 → "0 min", 45 → "45 min", 125 → "2 h 5 min". */
export function formatCommuteMinutes(minutes: number): string {
  const total = Math.round(minutes)
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Hours → "40 h" / "37,5 h" (Polish comma decimal; trailing ,0 dropped). */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')
  return `${text} h`
}

/** Display-ready aggregate metrics for the strip. Excludes fairnessScore by design. */
export interface GrafikMetricsView {
  /** metrics.commuteTotal in minutes, and its human label. */
  commuteMinutes: number
  commuteLabel: string
  /** metrics.etatDeviation in hours (Σ|worked − target|), and its label. */
  etatDeviationHours: number
  etatDeviationLabel: string
  /** Total scheduled hours summed from result.shifts, and its label. */
  scheduledHours: number
  scheduledHoursLabel: string
  /** Coverage: filled ÷ required for the solved week (0 when no demands). */
  filled: number
  required: number
  coverageRatio: number
  coveragePercent: number
  coverageLabel: string
}

/**
 * Derive the metrics-strip view from a SolveResult plus the summed `requiredCount` of the solved
 * week's demands (both already in the grafik view). Divide-by-zero guarded: no demands → 0%.
 */
export function deriveGrafikMetrics(result: SolveResult, requiredCountTotal: number): GrafikMetricsView {
  const scheduledHours = result.shifts.reduce((sum, s) => sum + shiftDurationHours(s), 0)
  const required = Math.max(0, requiredCountTotal)
  const filled = result.assignmentsCreated
  const coverageRatio = required > 0 ? filled / required : 0
  const coveragePercent = Math.round(coverageRatio * 100)
  return {
    commuteMinutes: result.metrics.commuteTotal,
    commuteLabel: formatCommuteMinutes(result.metrics.commuteTotal),
    etatDeviationHours: result.metrics.etatDeviation,
    etatDeviationLabel: formatHours(result.metrics.etatDeviation),
    scheduledHours,
    scheduledHoursLabel: formatHours(scheduledHours),
    filled,
    required,
    coverageRatio,
    coveragePercent,
    coverageLabel: `${coveragePercent}% · ${filled}/${required}`,
  }
}

// --- Browser client → local proxy routes (which forward to the real tenant-runtime) -------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new GrafikApiError(res.status, detail || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 502 (backend down). */
export class GrafikApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GrafikApiError'
  }
}

export const grafikApi = {
  employees: () => apiFetch<Employee[]>('/api/employees'),
  shifts: () => apiFetch<Shift[]>('/api/grafik/shifts'),
  demands: () => apiFetch<ShiftDemand[]>('/api/grafik/demands'),
  createShift: (input: CreateShiftInput) =>
    apiFetch<Shift>('/api/grafik/shifts', { method: 'POST', body: JSON.stringify(input) }),
  updateShift: (id: string, patch: UpdateShiftInput) =>
    apiFetch<Shift>(`/api/grafik/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteShift: (id: string) =>
    apiFetch<{ id: string }>(`/api/grafik/shifts/${id}`, { method: 'DELETE' }),
  solve: (input: SolveInput) =>
    apiFetch<SolveResult>('/api/grafik/solve', { method: 'POST', body: JSON.stringify(input) }),
}
