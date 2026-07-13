/**
 * Dostępy (physical/logical access grants — cards, keys, standalone permissions) client model for the
 * web-kit UAT surface.
 *
 * LIVE: `dostepyApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js proxy
 * at `/api/dostepy/*` (see app/api/dostepy/[[...path]] + lib/tenant-runtime.ts), which forwards to the
 * NestJS `GET/POST /dostepy`, `POST /dostepy/:id/revoke`, `GET /dostepy/:id` endpoints
 * (apps/tenant-runtime/src/dostepy) with a cookie-resolved Keycloak bearer.
 *
 * RODO: `AccessService`'s `ACCESS_SELECT` projection (dostepy.service.ts) already includes a SAFE
 * employee sub-object (`id`/`firstName`/`lastName`/`unitId` ONLY — no PESEL/home address), so every
 * row here already carries a displayable name. Unlike lib/ai-grafik.ts / lib/wnioski.ts, NO client-side
 * enrichment fetch against `/api/employees` is needed for the list — that endpoint is only used to
 * populate the issue form's employee `<select>` (see {@link dostepyApi.listEmployeesForSelect}).
 */

// --- enums: parity with packages/shared/src/leave.ts (AccessType / AccessStatus) -------------------

/** Kind of physical/logical access grant. Mirrors the Prisma `AccessType` enum / `packages/shared`. */
export type AccessType = 'CARD' | 'KEY' | 'PERMISSION'

export const ACCESS_TYPES: AccessType[] = ['CARD', 'KEY', 'PERMISSION']

const ACCESS_TYPE_LABEL: Record<AccessType, string> = {
  CARD: 'Karta dostępu',
  KEY: 'Klucz',
  PERMISSION: 'Uprawnienie',
}

/** Human-readable Polish label for an access type; echoes the raw value for an unknown type. */
export function accessTypeLabel(type: AccessType): string {
  return ACCESS_TYPE_LABEL[type] ?? type
}

/** Lifecycle status of an AccessGrant. Mirrors the Prisma `AccessStatus` enum / `packages/shared`. */
export type AccessStatus = 'ACTIVE' | 'REVOKED' | 'LOST'

export const ACCESS_STATUSES: AccessStatus[] = ['ACTIVE', 'REVOKED', 'LOST']

const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  ACTIVE: 'Aktywny',
  REVOKED: 'Odwołany',
  LOST: 'Zgubiony',
}

/** Human-readable Polish label for an access status; echoes the raw value for an unknown status. */
export function accessStatusLabel(status: AccessStatus): string {
  return ACCESS_STATUS_LABEL[status] ?? status
}

/** True only for an ACTIVE grant — the sole status the Revoke action is legal from (server has the
 *  final say via the optimistic `status: ACTIVE` lock in `AccessService.revoke`; this is purely which
 *  button the UI shows). */
export function canRevoke(status: AccessStatus): boolean {
  return status === 'ACTIVE'
}

// --- backend row shape + HTTP plumbing ---------------------------------------------------------------

/** The RODO-safe employee sub-object every AccessGrant row carries (`EMPLOYEE_SELECT` in the backend). */
export interface AccessEmployee {
  id: string
  firstName: string
  lastName: string
  unitId: string
}

/**
 * An AccessGrant row as returned by every `/dostepy*` read/write route — the tenant-runtime's
 * `ACCESS_SELECT` allowlist projection (dostepy.service.ts). `identifier` (card/key serial) IS
 * present for the managing scope; it is security-sensitive but not PII, and is never written to the
 * audit log server-side.
 */
export interface AccessGrant {
  id: string
  employeeId: string
  type: AccessType
  label: string
  identifier: string | null
  lokalizacjaId: string | null
  status: AccessStatus
  issuedByUserId: string | null
  issuedAt: string
  revokedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  employee: AccessEmployee
}

/** Filter for {@link dostepyApi.list}. */
export interface ListAccessParams {
  employeeId?: string
  status?: AccessStatus
}

/**
 * Body for {@link dostepyApi.issue} — mirrors `IssueAccessDto` (tenant-runtime) EXACTLY:
 * `employeeId`/`type`/`label` are required, `identifier`/`lokalizacjaId`/`notes` are optional.
 */
export interface IssueAccessInput {
  employeeId: string
  type: AccessType
  label: string
  identifier?: string
  lokalizacjaId?: string
  notes?: string
}

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 409 (conflict). */
export class DostepyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DostepyApiError'
  }
}

async function accessFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new DostepyApiError(res.status, humanizeAccessError(res.status, humanizeError(detail) || res.statusText))
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

/**
 * Translate the two known 409 messages `AccessService` throws in ENGLISH — `revoke`'s "not active"
 * (already revoked/lost) and "changed concurrently" (optimistic-lock race) — into Polish. Every other
 * message (including `issue`'s duplicate-identifier 409, which `mapWriteError` already throws in
 * Polish) passes through unchanged. Exported so the pure translation is unit-testable without a fetch.
 */
export function humanizeAccessError(status: number, message: string): string {
  if (status === 409) {
    if (message.includes('not active')) return 'Ten dostęp został już odwołany lub zgłoszony jako zgubiony.'
    if (message.includes('changed concurrently')) return 'Dostęp zmienił się w międzyczasie. Odśwież listę i spróbuj ponownie.'
  }
  return message
}

// --- issue-form pure validation (mirrors lib/employee-profile.ts's buildEmployeeCreate) -------------

/** Controlled-input state for the issue form (components/dostepy/dostepy-screen.tsx). Every field is a
 *  string so the inputs stay controlled; coerced/validated by {@link buildIssueBody} on submit. */
export interface IssueFormState {
  employeeId: string
  type: AccessType
  label: string
  identifier: string
  lokalizacjaId: string
  notes: string
}

export const EMPTY_ISSUE_FORM: IssueFormState = {
  employeeId: '',
  type: 'CARD',
  label: '',
  identifier: '',
  lokalizacjaId: '',
  notes: '',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pure validator + builder for the `POST /api/dostepy` body — returns `{ error }` with a Polish
 * message for the FIRST validation failure encountered, or the ready-to-POST body otherwise.
 * Required: employeeId (a roster selection), type (one of the 3 real enum values), label (trimmed,
 * non-empty — `IssueAccessDto.label` has no default). Optional: identifier/notes (trimmed, included
 * only when non-empty); lokalizacjaId (trimmed, included only when non-empty AND a well-formed UUID —
 * `IssueAccessDto.lokalizacjaId` is `@IsUUID()`, so catching a malformed value here avoids a round-trip
 * 400).
 */
export function buildIssueBody(form: IssueFormState): IssueAccessInput | { error: string } {
  const employeeId = form.employeeId.trim()
  if (!employeeId) return { error: 'Wybierz pracownika.' }

  if (!(ACCESS_TYPES as readonly string[]).includes(form.type)) {
    return { error: 'Wybierz rodzaj dostępu.' }
  }

  const label = form.label.trim()
  if (!label) return { error: 'Podaj etykietę (np. rodzaj karty/klucza).' }

  const body: IssueAccessInput = { employeeId, type: form.type, label }

  const identifier = form.identifier.trim()
  if (identifier) body.identifier = identifier

  const lokalizacjaId = form.lokalizacjaId.trim()
  if (lokalizacjaId) {
    if (!UUID_RE.test(lokalizacjaId)) return { error: 'Nieprawidłowy identyfikator lokalizacji (oczekiwano UUID).' }
    body.lokalizacjaId = lokalizacjaId
  }

  const notes = form.notes.trim()
  if (notes) body.notes = notes

  return body
}

// --- roster for the issue form's employee <select> ----------------------------------------------------

interface EmployeeLite {
  id: string
  firstName: string
  lastName: string
}

// --- dostepyApi: real fetch against /api/dostepy/* + /api/employees ----------------------------------

/**
 * The Dostępy API the screen talks to — same-origin `fetch` calls to the tenant-runtime proxy. Rows
 * already carry a RODO-safe employee sub-object (no enrichment fetch needed for the list); the roster
 * fetch below is ONLY for the issue form's employee picker. The backend RBAC + unit-scope + optimistic
 * lock have the final say; illegal actions surface as {@link DostepyApiError}.
 */
export const dostepyApi = {
  list(params: ListAccessParams = {}): Promise<AccessGrant[]> {
    const qs = new URLSearchParams()
    if (params.employeeId) qs.set('employeeId', params.employeeId)
    if (params.status) qs.set('status', params.status)
    const query = qs.toString()
    return accessFetch<AccessGrant[]>(`/api/dostepy${query ? `?${query}` : ''}`)
  },

  issue(input: IssueAccessInput): Promise<AccessGrant> {
    return accessFetch<AccessGrant>('/api/dostepy', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  /** Optimistic-locked on the backend (`status: ACTIVE`); a concurrent/duplicate revoke → 409. */
  revoke(id: string, reason?: string): Promise<AccessGrant> {
    return accessFetch<AccessGrant>(`/api/dostepy/${id}/revoke`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    })
  },

  getById(id: string): Promise<AccessGrant> {
    return accessFetch<AccessGrant>(`/api/dostepy/${id}`)
  },

  /** Roster for the issue form's employee `<select>` — NOT the list's employee sub-object (that's
   *  already on each row); this is a separate fetch to offer every employee in scope as a target. */
  listEmployeesForSelect(): Promise<EmployeeLite[]> {
    return accessFetch<EmployeeLite[]>('/api/employees')
  },
}
