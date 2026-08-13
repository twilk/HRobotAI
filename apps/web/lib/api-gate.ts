// Single source of truth for "may this request act on tenant data?" — shared by the edge middleware
// (middleware.ts) and the server-side proxy (lib/tenant-runtime.ts).
//
// WHY ONE MODULE. The gate and the token resolver MUST agree on what counts as a caller credential.
// If the gate let a request through on one rule and the resolver decided that same request had no
// caller token, the resolver would fall through to an AMBIENT service credential (a minted Keycloak
// token / TENANT_RUNTIME_DEV_TOKEN) and the BFF would talk to tenant-runtime on behalf of nobody.
// That is exactly the hole this module closes, so the two layers read the request through the SAME
// function rather than through two copies of a cookie regex.
//
// This module MUST stay dependency-free: middleware.ts runs in the edge bundle, so importing
// next/headers (or anything node-only) here would break it.

/** Name of the httpOnly session cookie set by the login server action (mirrors lib/session.ts). */
export const SESSION_COOKIE_NAME = 'hrobot_token'

/** A credential the CALLER supplied — as opposed to an ambient service token the server owns. */
export interface CallerCredential {
  authorization: string
  source: 'header' | 'cookie'
}

/**
 * API paths that are legitimately reachable WITHOUT a session, with the reason for each. This list
 * is deliberately short and is enforced by the parity guard in lib/api-gate.test.ts: everything else
 * under app/api/ is gated by default, so a new route is closed unless someone opens it here on
 * purpose.
 *
 * All three are PRE-AUTHENTICATION steps of the self-service signup flow rendered by
 * app/(marketing)/signup — they run before any tenant, user, or session exists, so requiring a
 * session would make signup impossible. None of them reaches tenant-runtime and none of them touches
 * personal data:
 *
 *  - /api/auth/signup          app/api/auth/signup/route.ts — local mock, returns a synthetic jobId.
 *                              Called by components/auth/signup-form.tsx.
 *  - /api/slugs                app/api/slugs/check/[slug]/route.ts — local mock, slug availability
 *                              against a hardcoded TAKEN set. Called by components/auth/slug-input.tsx.
 *  - /api/provision            app/api/provision/status/[jobId]/route.ts — local mock, advances a
 *                              canned step list from a timestamp. Called by
 *                              components/auth/provisioning-status.tsx.
 *
 * NOTE: login is NOT here. It is a server action (lib/auth-actions.ts `login`), not an API route, so
 * it needs no exemption — server actions are POSTed to the page route, not to /api.
 */
export const PUBLICZNE_API = ['/api/auth/signup', '/api/slugs', '/api/provision'] as const

/** True for anything under the BFF surface, including the bare `/api`. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/** True when `pathname` is covered by an entry in PUBLICZNE_API (exact match or a sub-path). */
export function isPublicApiPath(pathname: string): boolean {
  return PUBLICZNE_API.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * The credential the caller brought with them, in the same precedence order the proxy has always
 * used: an explicit `Authorization` header first, then the `hrobot_token` session cookie. Returns
 * null when the request carries neither — i.e. the caller is anonymous.
 *
 * An `Authorization` header counts as a caller credential even though it is not a browser session:
 * it is a token the CALLER supplied and owns, and tenant-runtime validates it against the realm JWKS
 * before answering, so a forged one buys nothing. What must never happen is the server lending its
 * OWN credential to an anonymous caller — that is what returning null here prevents.
 *
 * A cookie value that fails percent-decoding is treated as absent rather than throwing: a Keycloak
 * JWT is base64url and never contains `%`, so the only way to hit that branch is a malformed or
 * tampered cookie, which should fail closed.
 */
export function readCallerCredential(req: { headers: Headers }): CallerCredential | null {
  const header = req.headers.get('authorization')
  if (header) return { authorization: header, source: 'header' }

  const cookie = req.headers.get('cookie')
  const match = cookie ? /(?:^|;\s*)hrobot_token=([^;]+)/.exec(cookie) : null
  if (!match) return null

  let value: string
  try {
    value = decodeURIComponent(match[1]!)
  } catch {
    return null
  }
  return { authorization: `Bearer ${value}`, source: 'cookie' }
}

/**
 * The gate decision for a request that middleware has matched. Split out from middleware.ts so it can
 * be unit-tested without an edge runtime, and so lib/api-gate.test.ts asserts on the REAL rule rather
 * than a restatement of it.
 */
export function apiRequestIsAllowed(pathname: string, req: { headers: Headers }): boolean {
  if (isPublicApiPath(pathname)) return true
  return readCallerCredential(req) !== null
}
