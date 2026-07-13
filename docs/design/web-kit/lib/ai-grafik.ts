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
