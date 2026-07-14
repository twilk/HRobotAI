/**
 * `strategic-brain` client model for the web-kit UAT surface.
 *
 * LIVE: `strategicBrainApi` talks to the REAL tenant-runtime REST API through the same-origin
 * Next.js proxy at `/api/strategic-brain/*` (see app/api/strategic-brain/[[...path]] +
 * lib/tenant-runtime.ts), which forwards to the NestJS `strategic-brain` controller
 * (apps/tenant-runtime/src/strategic-brain/strategic-brain.controller.ts) with a cookie-resolved
 * Keycloak bearer.
 *
 * Mirrors lib/ai-grafik.ts: a thin `sbFetch` wrapper + a `StrategicBrainError` carrying the
 * upstream HTTP status, plus PURE formatting/label calculators exported separately so the
 * dashboard components (Task 13) and the unit tests share one source of truth. Every calculator
 * here operates on ALREADY-COMPUTED backend output (retention signal, slope, verdict, confidence,
 * composite score) — none of them touch PII or recompute scoring (RODO / M11 — the scorer's
 * allowlist and the null-policy live entirely server-side in scoring.util.ts).
 */

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 502 (down). */
export class StrategicBrainError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'StrategicBrainError'
  }
}

async function sbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new StrategicBrainError(res.status, humanizeError(detail) || res.statusText)
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

// --- API response types (mirror apps/tenant-runtime/src/strategic-brain/*.ts) ----------------------
//
// Decimal-typed backend fields (Prisma `Decimal`) can arrive as either a JSON number or a string
// depending on the serializer, same tolerance `ai-grafik.ts` uses for `estimatedCost` — every such
// field below is typed `number | string` (or nullable) rather than assumed to already be a number.

/** Level-vs-trend retention signal — parity with `RetentionSignal` in scoring.util.ts. */
export type RetentionSignal = 'UTRZYMAC' | 'OBSERWOWAC' | 'RYZYKO' | 'INWESTOWAC'

/** Recruitment verdict — parity with the Prisma `RecruitmentVerdict` enum. */
export type RecruitmentVerdict = 'WZNOW' | 'WSTRZYMAJ' | 'UTRZYMAJ'

/** Recommendation scope — parity with the Prisma `RecoScopeType` enum. */
export type RecoScopeType = 'LOKALIZACJA' | 'UNIT'

/** Tenant-wide proactivity setting — parity with the Prisma `ProactivityLevel` enum. */
export type ProactivityLevel = 'TYLKO_NA_ZADANIE' | 'PROAKTYWNE_REKOMENDACJE' | 'PROAKTYWNE_ALERTY'

/**
 * One window's numeric-only projection of an `EmployeePerformanceSnapshot`
 * (`SnapshotService.toHeatCell`) — no PII, ids + metrics only. Used both for the overview heatmap
 * (one row per employee, latest window) and as an element of an employee card's sparkline series.
 */
export interface SnapshotCell {
  employeeId: string
  windowStart: string
  windowEnd: string
  throughput: number
  slaHitRate: number | string | null
  defectRate: number | string | null
  compositeScore: number | string | null
  developmentSlope: number | string | null
  confidence: number | string
  isNewHire: boolean
  excludedReason: string | null
}

/** `GET /strategic-brain/overview` response (`StrategicBrainController.overview`). */
export interface Overview {
  heatmap: SnapshotCell[]
  recruitment: RecruitmentRecommendation[]
}

/** The frozen `factors` a card's latest window carries (`SnapshotService.buildCard`). */
export interface EmployeeCardFactors {
  compositeScore: number | null
  developmentSlope: number | null
  confidence: number
  slaHitRate: number | null
  defectRate: number | null
  throughput: number
  isNewHire: boolean
  excludedReason: string | null
}

/**
 * `GET /strategic-brain/employee/:id` and `GET /strategic-brain/employee/me` response
 * (`SnapshotService.buildCard`). `series` is windowEnd-ascending — feed it directly to a
 * sparkline. `retentionSignal`/`factors` are derived from the LATEST window only, `null` when the
 * employee has no snapshot yet.
 */
export interface EmployeeCard {
  employeeId: string
  series: SnapshotCell[]
  retentionSignal: RetentionSignal | null
  factors: EmployeeCardFactors | null
}

/**
 * A `RecruitmentRecommendation` row (`RecommendationService.listRecruitment`/`emitRecruitment`) —
 * an immutable event (B3); "current" = the newest one per `(scopeType, scopeId)`. `factors` is
 * frozen JSON at emission time — shape documented in `emitRecruitment` (`totalGap`, `byRole`,
 * `avgDefectRate`, `avgSlaHitRate`, `defectThreshold`, `slaTargetRate`, `qualityBelowTarget`,
 * `timelinessBelowTarget`, `employeeCount`, `weekStart`), left loosely typed here since the UI
 * only needs `rationale` for display.
 */
export interface RecruitmentRecommendation {
  id: string
  scopeType: RecoScopeType
  scopeId: string
  verdict: RecruitmentVerdict
  rationale: string
  factors: Record<string, unknown>
  replacesRecommendationId: string | null
  computedAt: string
  acknowledgedByUserId: string | null
  acknowledgedAt: string | null
}

/** `GET`/`PATCH /strategic-brain/config` response (raw `PerformanceConfig` row). */
export interface PerformanceConfig {
  id: string
  unitId: string | null
  weightPerformance: number | string
  weightTimeliness: number | string
  weightQuality: number | string
  weightDevelopment: number | string
  slaTargetMinutes: number
  defectThreshold: number | string
  confidenceMinDays: number
  windowDays: number
  minValidWindows: number
  minSlopeForGrowth: number | string
  minPeerGroupSize: number
  proactivityLevel: ProactivityLevel
  createdAt: string
  updatedAt: string
}

/** Fields `PATCH /strategic-brain/config` accepts — parity with `UpdatePerformanceConfigDto`. */
export interface UpdatePerformanceConfigInput {
  unitId?: string
  weightPerformance?: number
  weightTimeliness?: number
  weightQuality?: number
  weightDevelopment?: number
  slaTargetMinutes?: number
  defectThreshold?: number
  confidenceMinDays?: number
  windowDays?: number
  minValidWindows?: number
  minSlopeForGrowth?: number
  minPeerGroupSize?: number
  proactivityLevel?: ProactivityLevel
}

// --- live client --------------------------------------------------------------------------------

export const strategicBrainApi = {
  getOverview: (): Promise<Overview> => sbFetch<Overview>('/api/strategic-brain/overview'),

  /** Another employee's card — HR/ADMIN/MANAGER only per the backend RBAC gate. */
  getEmployeeCard: (employeeId: string): Promise<EmployeeCard> =>
    sbFetch<EmployeeCard>(`/api/strategic-brain/employee/${employeeId}`),

  /** The caller's OWN card — any authenticated employee, including a plain PRACOWNIK (M17). */
  getMyEmployeeCard: (): Promise<EmployeeCard> => sbFetch<EmployeeCard>('/api/strategic-brain/employee/me'),

  listRecruitment: (): Promise<RecruitmentRecommendation[]> =>
    sbFetch<RecruitmentRecommendation[]>('/api/strategic-brain/recruitment'),

  /** [M19/M13] Log a human's acknowledgement — never a personnel action. HR/ADMIN only. */
  acknowledgeRecruitment: (id: string): Promise<RecruitmentRecommendation> =>
    sbFetch<RecruitmentRecommendation>(`/api/strategic-brain/recruitment/${id}/acknowledge`, { method: 'POST' }),

  getConfig: (unitId?: string): Promise<PerformanceConfig> =>
    sbFetch<PerformanceConfig>(`/api/strategic-brain/config${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''}`),

  updateConfig: (input: UpdatePerformanceConfigInput): Promise<PerformanceConfig> =>
    sbFetch<PerformanceConfig>('/api/strategic-brain/config', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
}

// --- pure formatting calculators ------------------------------------------------------------------
//
// No network, no PII: every function below is a pure projection of already-computed backend output
// onto a Polish label / semantic tone / arrow the UI renders. Kept separate from the fetch layer so
// the components AND the unit tests share exactly one source of truth (mirrors autonomyLabel /
// proposalStateLabel in lib/ai-grafik.ts).

/** Semantic tone key for a retention signal — kept distinct from any brand accent color (spec §8:
 * "Semantyka kolorów osobno od akcentu") so the dashboard can theme INWESTOWAC vs RYZYKO distinctly
 * without hard-coding a color name into this pure layer. */
export type RetentionTone = 'good' | 'invest' | 'risk' | 'watch'

const RETENTION_LABEL: Record<RetentionSignal, { label: string; tone: RetentionTone }> = {
  UTRZYMAC: { label: 'Utrzymać', tone: 'good' },
  INWESTOWAC: { label: 'Inwestować', tone: 'invest' },
  RYZYKO: { label: 'Ryzyko', tone: 'risk' },
  OBSERWOWAC: { label: 'Obserwować', tone: 'watch' },
}

/** Polish label + semantic tone for a `RetentionSignal` (card badge / heatmap cell legend). */
export function retentionLabel(signal: RetentionSignal): { label: string; tone: RetentionTone } {
  return RETENTION_LABEL[signal]
}

/** Slope magnitude (absolute value) below which the trend is displayed as "flat" rather than
 * rising/declining — pure display smoothing so sub-noise slope jitter doesn't flip the arrow; NOT
 * the same threshold as the backend's `minSlopeForGrowth` (a scoring/retention-signal decision). */
const FLAT_SLOPE_EPSILON = 0.05

export type SlopeTrend = 'rising' | 'flat' | 'declining' | 'unknown'

/** Arrow + trend word for a `developmentSlope` value. `null` (M9: not enough valid windows yet —
 * an UNKNOWN trend, never conflated with a known-flat or known-declining one) → `—`/`unknown`. */
export function slopeIndicator(slope: number | null): { arrow: '↑' | '→' | '↓' | '—'; trend: SlopeTrend } {
  if (slope === null) return { arrow: '—', trend: 'unknown' }
  if (slope > FLAT_SLOPE_EPSILON) return { arrow: '↑', trend: 'rising' }
  if (slope < -FLAT_SLOPE_EPSILON) return { arrow: '↓', trend: 'declining' }
  return { arrow: '→', trend: 'flat' }
}

const VERDICT_LABEL: Record<RecruitmentVerdict, string> = {
  WZNOW: 'Wznów rekrutację',
  WSTRZYMAJ: 'Wstrzymaj rekrutację',
  UTRZYMAJ: 'Utrzymaj',
}

/** Polish action label for a `RecruitmentVerdict` (recruitment panel button/badge copy). */
export function verdictLabel(verdict: RecruitmentVerdict): string {
  return VERDICT_LABEL[verdict] ?? verdict
}

/** Confidence (0..1) below which a card's figures are disclosed as orientation-only — mirrors
 * `CARD_RETENTION_CONFIDENCE_MIN`/`RETENTION_CONFIDENCE_MIN` (snapshot.service.ts /
 * recommendation.service.ts) BY VALUE, same cross-layer convention those two use to stay in
 * agreement without an import across the tenant-runtime/web-kit boundary. */
export const CONFIDENCE_DISCLOSURE_THRESHOLD = 0.5

/**
 * [M10] A short Polish disclosure note for a low-confidence score or a peer group too small for a
 * meaningful normalization — `null` when neither applies (no banner needed). Low confidence is
 * checked FIRST: a score computed from too little data is the more fundamental caveat, so it wins
 * over the peer-group note when both are true. `meaningful` defaults to `true` (assume the peer
 * normalization was fine) when the caller doesn't have that signal.
 */
export function confidenceDisclosure(confidence: number, meaningful = true): string | null {
  if (confidence < CONFIDENCE_DISCLOSURE_THRESHOLD) return 'Ocena orientacyjna — za mało danych'
  if (!meaningful) return 'Grupa zbyt mała — normalizacja orientacyjna'
  return null
}

/** `'—'` for a null score, else the score rounded to an integer 0..100 (composite/dimension scores
 * are stored/transmitted with decimal precision but always displayed as whole numbers). */
export function formatScore(n: number | null): string {
  if (n === null) return '—'
  return String(Math.round(n))
}
