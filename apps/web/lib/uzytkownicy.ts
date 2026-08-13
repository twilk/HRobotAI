/**
 * Użytkownicy (user invites + RBAC role management) client model for the web-kit UAT surface.
 *
 * LIVE: `uzytkownicyApi` talks to the REAL tenant-runtime REST API through the same-origin Next.js
 * proxy at `/api/uzytkownicy/*` (see app/api/uzytkownicy/[[...path]] + lib/tenant-runtime.ts), which
 * forwards to the NestJS `GET/POST /uzytkownicy`, `POST/DELETE /uzytkownicy/:userId/roles`,
 * `POST /uzytkownicy/:userId/deactivate` endpoints (apps/tenant-runtime/src/users) with a
 * cookie-resolved Keycloak bearer. The WHOLE controller is ADMIN_KLIENTA-only server-side
 * (`UsersController`'s class-level `@TenantRoute(Role.ADMIN_KLIENTA)`) — every call here can 403 for
 * anyone else, and the page (app/(tenant)/ustawienia/uzytkownicy/page.tsx) gates on the same role
 * client-side so a non-admin never even renders this screen.
 *
 * RODO: `UsersService.list`'s `SAFE_USER_SELECT` never returns anything beyond id/email/active/
 * createdAt/roles — no PESEL, no home address, nothing beyond a login email.
 */

import type { Role } from './nav'

export type { Role }

/** Every role the invite/assign forms may pick. Parity with the tenant `Role` Prisma enum
 *  (PRACOWNIK | MANAGER | HR | ADMIN_KLIENTA) — same values `lib/nav.ts`'s `Role` type already uses. */
export const ROLES: Role[] = ['PRACOWNIK', 'MANAGER', 'HR', 'ADMIN_KLIENTA']

const ROLE_LABEL: Record<Role, string> = {
  PRACOWNIK: 'Pracownik',
  MANAGER: 'Menedżer',
  HR: 'HR',
  ADMIN_KLIENTA: 'Admin klienta',
}

/** Human-readable Polish label for a role; echoes the raw value for an unknown role. */
export function roleLabel(role: Role): string {
  return ROLE_LABEL[role] ?? role
}

/** One (role, unitId) grant on a user row — `unitId: null` is a GLOBAL (tenant-wide) grant. */
export interface UserRoleGrant {
  role: Role
  unitId: string | null
}

/** A tenant `User` row as returned by every `/uzytkownicy*` route — `UsersService`'s RODO-safe
 *  `SAFE_USER_SELECT` projection: id/email/active/createdAt/roles only. */
export interface TenantUser {
  id: string
  email: string
  active: boolean
  createdAt: string
  roles: UserRoleGrant[]
}

/**
 * True iff `userId` currently holds the ONLY active GLOBAL (`unitId: null`) `ADMIN_KLIENTA` grant
 * among `users` — mirrors the backend's LAST-ADMIN invariant (`UsersService.guardedAdminMutation`)
 * purely from already-fetched roster data, so the UI can pre-emptively disable the Deactivate /
 * revoke-Admin controls with an explanatory hint instead of letting the admin hit a blind 409. The
 * backend re-checks this itself inside a SERIALIZABLE transaction on every actual mutation — this is a
 * UX convenience only, never the authorization boundary.
 */
export function isOnlyActiveGlobalAdmin(users: Pick<TenantUser, 'id' | 'active' | 'roles'>[], userId: string): boolean {
  const activeGlobalAdminIds = new Set(
    users
      .filter((u) => u.active && u.roles.some((r) => r.role === 'ADMIN_KLIENTA' && r.unitId === null))
      .map((u) => u.id),
  )
  return activeGlobalAdminIds.size === 1 && activeGlobalAdminIds.has(userId)
}

/**
 * Whether the role-management / Deactivate controls for `target` should be rendered enabled — false
 * only when `target` is the tenant's sole remaining active global admin (see
 * {@link isOnlyActiveGlobalAdmin}). Every other row is manageable from the UI's point of view; the
 * backend's ADMIN_KLIENTA-actor + self-escalation + last-admin guards have the final say regardless.
 */
export function canManageUser(
  target: Pick<TenantUser, 'id' | 'active' | 'roles'>,
  users: Pick<TenantUser, 'id' | 'active' | 'roles'>[],
): boolean {
  return !isOnlyActiveGlobalAdmin(users, target.id)
}

// --- HTTP plumbing (mirrors lib/dostepy.ts / lib/ai-grafik.ts) --------------------------------------

/** Carries the upstream HTTP status so the UI can distinguish 401 (auth) / 403 (RBAC) / 409 (conflict). */
export class UzytkownicyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UzytkownicyApiError'
  }
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
 * Translate the known `UsersService` error messages (409 duplicate email / last-admin / concurrent
 * admin-roster race, 403 self-escalation / ADMIN_KLIENTA-required) into friendly Polish banners. Any
 * other message passes through unchanged. Exported so the pure translation is unit-testable without a
 * fetch — mirrors `lib/dostepy.ts`'s `humanizeAccessError`.
 */
export function humanizeUsersError(status: number, message: string): string {
  if (status === 409) {
    if (message.includes('already exists')) return 'Użytkownik z tym adresem e-mail już istnieje.'
    if (message.includes('last ADMIN_KLIENTA')) return 'Nie można odebrać roli ostatniemu adminowi klienta w tej organizacji.'
    if (message.includes('changed concurrently')) return 'Lista adminów zmieniła się w międzyczasie. Odśwież listę i spróbuj ponownie.'
  }
  if (status === 403) {
    if (message.includes('grant yourself')) return 'Nie możesz nadać sobie wyższej roli niż aktualnie posiadasz.'
    return 'Brak uprawnień administratora klienta do wykonania tej operacji.'
  }
  return message
}

/**
 * `assignRole`/`revokeRole`/`deactivate` are void-returning on the backend
 * (`UsersController`'s POST/DELETE handlers carry no `@HttpCode`, so Nest answers with the DEFAULT
 * status — 201 for POST, 200 for DELETE — and an EMPTY body, never 204). Unlike `ai-grafik.ts`'s
 * `aiFetch`/`dostepy.ts`'s `accessFetch` (which only special-case `status === 204`), this reads the
 * response TEXT first and treats an empty body as `undefined` regardless of status, so those empty
 * 200/201 responses don't throw on `JSON.parse('')`.
 */
async function usersFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new UzytkownicyApiError(res.status, humanizeUsersError(res.status, humanizeError(text) || res.statusText))
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** Body for {@link uzytkownicyApi.invite} — mirrors `InviteUserDto` exactly. */
export interface InviteInput {
  email: string
  role: Role
  unitId?: string
}

/** Body for {@link uzytkownicyApi.assignRole}/{@link uzytkownicyApi.revokeRole} — mirrors `RoleAssignmentDto`. */
export interface RoleAssignmentInput {
  role: Role
  unitId?: string
}

/** `{id,name}` row from `GET /grafik/units` — feeds the per-row role-grant mini-form's optional Unit
 *  `<select>` (see {@link uzytkownicyApi.listUnitsForSelect}). ADMIN_KLIENTA (this screen's sole
 *  audience) is one of `GrafikController`'s READ_ROLES, so the same-role fetch is safe. */
export interface UnitLite {
  id: string
  name: string
}

/**
 * The Użytkownicy API the screen talks to — same-origin `fetch` calls to the tenant-runtime proxy.
 * The backend RBAC + saga ordering + guards (self-escalation, last-admin, JWT-cache re-check) have the
 * final say; illegal actions surface as {@link UzytkownicyApiError} with an already-humanized message.
 */
export const uzytkownicyApi = {
  list(): Promise<TenantUser[]> {
    return usersFetch<TenantUser[]>('/api/uzytkownicy')
  },

  /** ADMIN_KLIENTA-only: runs the KC-create → DB-create(+compensate) → GRANT → best-effort-email saga. */
  invite(input: InviteInput): Promise<TenantUser> {
    return usersFetch<TenantUser>('/api/uzytkownicy', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  /** GRANT ordering (UserRole first, then Keycloak) + self-escalation guard enforced server-side. */
  assignRole(userId: string, input: RoleAssignmentInput): Promise<void> {
    return usersFetch<void>(`/api/uzytkownicy/${userId}/roles`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  /** REVOKE ordering (Keycloak first, then UserRole) + last-admin guard enforced server-side. */
  revokeRole(userId: string, input: RoleAssignmentInput): Promise<void> {
    return usersFetch<void>(`/api/uzytkownicy/${userId}/roles`, {
      method: 'DELETE',
      body: JSON.stringify(input),
    })
  },

  /** Keycloak `setEnabled(false)` first, then `User.active = false`; last-admin guarded server-side. */
  deactivate(userId: string): Promise<void> {
    return usersFetch<void>(`/api/uzytkownicy/${userId}/deactivate`, { method: 'POST' })
  },

  /** Catalog for the role-grant mini-form's optional Unit `<select>` — a separate fetch against the
   *  `/grafik/units` proxy (not a `/uzytkownicy` route). */
  listUnitsForSelect(): Promise<UnitLite[]> {
    return usersFetch<UnitLite[]>('/api/grafik/units')
  },
}

// --- invite-form pure validation (mirrors lib/dostepy.ts's buildIssueBody) --------------------------

/** Controlled-input state for the invite form (components/users/users-screen.tsx). Every field is a
 *  string so the inputs stay controlled; coerced/validated by {@link buildInviteBody} on submit. */
export interface InviteFormState {
  email: string
  role: Role
  unitId: string
}

export const EMPTY_INVITE_FORM: InviteFormState = {
  email: '',
  role: 'PRACOWNIK',
  unitId: '',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Pure validator + builder for the `POST /api/uzytkownicy` body — returns `{ error }` with a Polish
 * message for the FIRST validation failure encountered, or the ready-to-POST body otherwise.
 * Required: email (trimmed, well-formed), role (one of the 4 real enum values). Optional: unitId
 * (trimmed, included only when non-empty AND a well-formed UUID — `InviteUserDto.unitId` is
 * `@IsUUID()`, so catching a malformed value here avoids a round-trip 400).
 */
export function buildInviteBody(form: InviteFormState): InviteInput | { error: string } {
  const email = form.email.trim()
  if (!email) return { error: 'Podaj adres e-mail.' }
  if (!EMAIL_RE.test(email)) return { error: 'Nieprawidłowy adres e-mail.' }

  if (!(ROLES as readonly string[]).includes(form.role)) {
    return { error: 'Wybierz rolę.' }
  }

  const body: InviteInput = { email, role: form.role }

  const unitId = form.unitId.trim()
  if (unitId) {
    if (!UUID_RE.test(unitId)) return { error: 'Nieprawidłowy identyfikator jednostki (oczekiwano UUID).' }
    body.unitId = unitId
  }

  return body
}
