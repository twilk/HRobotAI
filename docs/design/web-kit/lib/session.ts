// Server-only session reader. Decodes the httpOnly `hrobot_token` cookie (a Keycloak access token
// set by the login server action in lib/auth-actions.ts) to surface the REAL logged-in identity —
// name / preferred_username + the `hrobot_roles` claim — to server components (topbar, nav RBAC).
//
// This does NOT verify the JWT signature: tenant-runtime is the security boundary (it validates the
// bearer on every proxied call). Here we only read display claims for UI, so a plain base64url decode
// is sufficient. Keep this module server-only — the token must never reach a client bundle.

import { cookies } from 'next/headers'
import type { Role } from './nav'

/** Cookie name shared with the login/logout actions and the tenant-runtime proxy. */
export const SESSION_COOKIE = 'hrobot_token'

export interface SessionUser {
  /** Display name for the topbar. */
  name: string
  /** Human-readable role label (Polish), derived from the highest-privilege role. */
  role: string
  /** Two-letter avatar initials. */
  initials: string
}

export interface Session {
  /** Raw access token (also forwarded by the proxy via the cookie). */
  token: string
  /** Keycloak preferred_username. */
  username: string
  /** RBAC roles from the `hrobot_roles` claim, filtered to the ones the app knows. */
  roles: Role[]
  user: SessionUser
}

const KNOWN_ROLES: Role[] = ['PRACOWNIK', 'MANAGER', 'HR', 'ADMIN_KLIENTA']

const ROLE_LABEL: Record<Role, string> = {
  ADMIN_KLIENTA: 'Admin klienta',
  HR: 'HR',
  MANAGER: 'Menedżer',
  PRACOWNIK: 'Pracownik',
}

/** Most-privileged first — the topbar shows the highest role the user holds. */
const ROLE_PRIORITY: Role[] = ['ADMIN_KLIENTA', 'HR', 'MANAGER', 'PRACOWNIK']

/** Base64url-decode + JSON.parse a JWT payload. Returns null on any malformation. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(b64, 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Derive avatar initials from a display name ("Jan Kowalski" -> "JK"). */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Resolve the current session from the `hrobot_token` cookie, or null when there is no cookie or it
 * can't be decoded. Routes are gated by middleware, so authenticated pages can treat null as a rare
 * edge (stale/tampered cookie) and fall back to a safe default.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const claims = decodeJwtPayload(token)
  if (!claims) return null

  const rawRoles = Array.isArray(claims.hrobot_roles) ? (claims.hrobot_roles as unknown[]) : []
  const roles = KNOWN_ROLES.filter((r) => rawRoles.includes(r))

  const username = typeof claims.preferred_username === 'string' ? claims.preferred_username : ''
  const fullName = typeof claims.name === 'string' ? claims.name.trim() : ''
  const name = fullName || username || 'Użytkownik'

  const primary = ROLE_PRIORITY.find((r) => roles.includes(r))
  const role = primary ? ROLE_LABEL[primary] : 'Użytkownik'

  return {
    token,
    username,
    roles,
    user: { name, role, initials: initialsFrom(name) },
  }
}
