/**
 * `agent-glosowy` (Agent Głosowy, M3 module 3) client model for the web-kit UAT surface.
 *
 * LIVE: `agentGlosowyApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js
 * proxy at `/api/agent-glosowy/*` (see app/api/agent-glosowy/[[...path]] + lib/tenant-runtime.ts),
 * which forwards to the NestJS `agent-glosowy` controller
 * (apps/tenant-runtime/src/agent-glosowy/agent-glosowy.controller.ts) with a cookie-resolved
 * Keycloak bearer.
 *
 * Mirrors lib/strategic-brain.ts / lib/dokumenty.ts: a thin `agentFetch` wrapper + an
 * `AgentGlosowyError` carrying the upstream HTTP status, plus PURE formatting/decision calculators
 * exported separately so the screen (app/(tenant)/asystent/page.tsx + components/asystent/*) and
 * the unit tests share one source of truth. This is a TEXT-first command assistant: the module is
 * two calls — `interpret` (describe, no side effect) then `execute` (run, behind a human-confirm
 * gate for writes) — mirroring `VoiceCommandService.interpret`/`.execute` EXACTLY (same TypeScript
 * shapes, hand-kept in sync since the two apps don't share a package boundary).
 */

// --- API response types (mirror apps/tenant-runtime/src/agent-glosowy/{intent.util,voice-command.service}.ts) --

/** The CLOSED command set of three (spec §6) + the out-of-set sentinel — parity with `AgentIntent`. */
export type AgentIntent = 'URLOP' | 'L4' | 'MOJ_GRAFIK' | 'NIEZNANE'

/** Slots extracted from an utterance — parity with `ParsedEntities`. Dates are ISO `YYYY-MM-DD`. */
export interface AgentEntities {
  dateFrom?: string
  dateTo?: string
  /** Leave kind for a write intent (e.g. `URLOP_WYPOCZYNKOWY` / `ZWOLNIENIE_LEKARSKIE`). */
  type?: string
}

export type ProposedActionKind = 'CREATE_LEAVE' | 'READ_SCHEDULE' | 'NONE'

/** A description of what WOULD happen — never a side effect. Parity with `ProposedAction`. */
export interface ProposedAction {
  kind: ProposedActionKind
  method?: 'POST' | 'GET'
  endpoint?: string
  body?: Record<string, unknown>
}

/** `POST /agent-glosowy/interpret` response — parity with `InterpretResult`. */
export interface InterpretResult {
  intent: AgentIntent
  entities: AgentEntities
  /** 0..1 — see {@link CONFIDENCE_THRESHOLD}. */
  confidence: number
  /** Write intents (URLOP/L4) → true. A read (MOJ_GRAFIK) → false. */
  requiresConfirmation: boolean
  /** NIEZNANE or sub-threshold confidence → the UI must show a manual form, never guess-execute. */
  fallbackToForm: boolean
  proposedAction: ProposedAction
  humanReadable: string
  /** EU AI Act transparency notice — always present, rendered verbatim by the UI. */
  aiNotice: string
}

/** `POST /agent-glosowy/execute` body — the client replays `intent`/`entities` from a prior
 *  `interpret` plus a `confirm` flag. For a write intent (URLOP/L4) the backend REQUIRES
 *  `confirm === true` (human-in-the-loop) and 400s otherwise. */
export interface ExecuteInput {
  intent: AgentIntent
  entities?: AgentEntities
  confirm?: boolean
}

/** `POST /agent-glosowy/execute` response — parity with `ExecuteResult`. */
export interface ExecuteResult {
  executed: boolean
  intent: AgentIntent
  requiresConfirmation: boolean
  fallbackToForm: boolean
  result?: unknown
  humanReadable: string
  aiNotice: string
  /** True only on a write that a human explicitly confirmed (art. 22 audit trail). */
  confirmedByHuman?: boolean
}

// --- fetch plumbing (mirrors sbFetch/StrategicBrainError in lib/strategic-brain.ts) -------------------

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 400 (missing confirm or
 *  date) / 502 (backend down). */
export class AgentGlosowyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AgentGlosowyError'
  }
}

async function agentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new AgentGlosowyError(res.status, humanizeError(detail) || res.statusText)
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

export const agentGlosowyApi = {
  /** Parse `text` and describe what WOULD happen — no side effect. Any authenticated role. */
  interpret: (text: string): Promise<InterpretResult> =>
    agentFetch<InterpretResult>('/api/agent-glosowy/interpret', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  /** Run a previously-interpreted command. Writes (URLOP/L4) need `confirm: true`; reads run directly. */
  execute: (input: ExecuteInput): Promise<ExecuteResult> =>
    agentFetch<ExecuteResult>('/api/agent-glosowy/execute', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

// --- pure formatting / decision calculators ------------------------------------------------------
//
// No network, no PII: every function below is a pure projection of already-computed backend output
// (an InterpretResult/ExecuteResult) onto Polish display text or a UI decision. Kept separate from
// the fetch layer so the component AND the unit tests share exactly one source of truth (mirrors
// retentionLabel/verdictLabel in lib/strategic-brain.ts, documentTypeLabel/-co in lib/dokumenty.ts).

const INTENT_LABEL: Record<AgentIntent, string> = {
  URLOP: 'Wniosek urlopowy',
  L4: 'Zwolnienie lekarskie (L4)',
  MOJ_GRAFIK: 'Mój grafik',
  NIEZNANE: 'Nierozpoznane polecenie',
}

/** Polish label for an `AgentIntent` (result card heading); echoes the raw value for an unknown
 *  intent rather than throwing. */
export function intentLabel(intent: AgentIntent): string {
  return INTENT_LABEL[intent] ?? intent
}

/** Below this the backend falls back to a manual form rather than acting on the parse — mirrors
 *  `CONFIDENCE_THRESHOLD` (intent.util.ts) BY VALUE, same cross-layer convention
 *  `CONFIDENCE_DISCLOSURE_THRESHOLD` (lib/strategic-brain.ts) uses to stay in agreement without an
 *  import across the tenant-runtime/web-kit boundary. */
export const CONFIDENCE_THRESHOLD = 0.7

/** Semantic tone key, restricted to the `Badge` component's own tone union (components/ui/badge.tsx). */
export type ConfidenceTone = 'ok' | 'warn' | 'muted'

/**
 * Semantic tone for a parse confidence (0..1): `>= CONFIDENCE_THRESHOLD` → safe to propose (`ok`);
 * `> 0` but below it → recognized-but-uncertain (`warn`, still falls back per the backend); `0`
 * (NIEZNANE) → `muted`. Pure display classification only — the actual fallback DECISION is the
 * backend's `fallbackToForm` flag, never re-derived from this threshold client-side.
 */
export function confidenceTone(confidence: number): ConfidenceTone {
  if (confidence >= CONFIDENCE_THRESHOLD) return 'ok'
  if (confidence > 0) return 'warn'
  return 'muted'
}

/** `"90%"` from a 0..1 confidence value, rounded to the nearest whole percent. */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/**
 * Whether the "Potwierdź i wykonaj" human-in-the-loop button should render for a given interpret
 * result (EU AI Act / art. 22 RODO — a write never runs without an explicit human click). A
 * fallback-to-form result never shows a confirm button even if `requiresConfirmation` were somehow
 * also true, since NIEZNANE/low-confidence must never be executed at all (defence in depth against
 * a backend response that disagrees with itself).
 */
export function shouldShowConfirm(result: Pick<InterpretResult, 'requiresConfirmation' | 'fallbackToForm'>): boolean {
  return result.requiresConfirmation && !result.fallbackToForm
}

/**
 * Whether a read intent may execute immediately with no confirm click (the mirror image of
 * {@link shouldShowConfirm}): recognized (not falling back) and NOT requiring confirmation.
 */
export function canAutoExecute(result: Pick<InterpretResult, 'requiresConfirmation' | 'fallbackToForm'>): boolean {
  return !result.requiresConfirmation && !result.fallbackToForm
}

/** Polish guidance shown when the backend asks the user to fall back to a manual form
 *  (`fallbackToForm: true`) — with a link to the closest manual entry point for the two writable
 *  intents this module knows about; `null` href when no obviously-closer form applies. */
export interface FallbackLink {
  label: string
  href: string
}

const FALLBACK_LINK_BY_INTENT: Record<AgentIntent, FallbackLink> = {
  URLOP: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  L4: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
  MOJ_GRAFIK: { label: 'Przejdź do grafiku', href: '/grafik' },
  NIEZNANE: { label: 'Przejdź do formularza wniosków', href: '/wnioski' },
}

/** The manual-form link to offer alongside "Nie zrozumiałem" — best-guess by intent when one was
 *  still recognized at low confidence, else the generic wnioski link (`NIEZNANE`). */
export function fallbackLink(intent: AgentIntent): FallbackLink {
  return FALLBACK_LINK_BY_INTENT[intent] ?? FALLBACK_LINK_BY_INTENT.NIEZNANE
}

/** The fixed Polish copy shown above a fallback result — SPEC-mandated wording ("Nie zrozumiałem —
 *  użyj formularza"), never invented per-intent so the module stays predictable/auditable. */
export const FALLBACK_MESSAGE = 'Nie zrozumiałem — użyj formularza.'
