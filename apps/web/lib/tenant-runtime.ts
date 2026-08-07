// Server-only proxy to the real tenant-runtime (NestJS) API. Next.js route handlers under
// app/api/grafik/** and app/api/employees call proxyToTenantRuntime() so the browser never talks
// to the backend directly — that keeps the bearer token server-side and sidesteps CORS entirely
// (this is a same-process server→server fetch, not a cross-origin browser request).
//
// AUTH: tenant-runtime derives the tenant from the Keycloak JWT issuer (`iss` → realm `hrobot-<slug>`)
// and gates every route with KeycloakJwtGuard, so all we must do is forward a valid Bearer token.
// The token is resolved, in priority order, from: the caller's Authorization header → an
// `hrobot_token` cookie (both read via lib/api-gate.ts `readCallerCredential`, the SAME function the
// middleware gate uses) → a freshly minted Keycloak token (direct grant, see lib/keycloak-token.ts)
// → the legacy TENANT_RUNTIME_DEV_TOKEN env (a static service token).
//
// The last two are AMBIENT credentials: they belong to the server, not to the caller, so using one
// means the BFF fetches tenant data on behalf of somebody who proved nothing. They are therefore
// opt-in via HROBOT_ALLOW_AMBIENT_TOKEN and unavailable in any configuration that does not set it —
// see ambientServiceTokenAllowed() below.

import { getKeycloakToken } from './keycloak-token'
import { cookies } from 'next/headers'
import { readCallerCredential } from './api-gate'
import { refreshAccessToken } from './refresh-token'
import { SESSION_COOKIE, REFRESH_COOKIE } from './session'

/** Base URL of the tenant-runtime service. Local dev default; override for the compose network. */
export function tenantRuntimeBaseUrl(): string {
  const raw = process.env.TENANT_RUNTIME_URL ?? 'http://localhost:3001'
  return raw.replace(/\/+$/, '')
}

/**
 * A resolved bearer plus where it came from — only a minted token is worth force-refreshing +
 * retrying on a backend 401 (a caller-supplied header or the static dev token can't be re-minted
 * here); a cookie token can instead be rotated via the user's refresh token.
 */
interface ResolvedAuth {
  authorization: string
  source: 'header' | 'cookie' | 'minted' | 'dev'
}

/**
 * Whether this process may lend its OWN credential to a request that brought none — i.e. use the
 * minted Keycloak token or the static TENANT_RUNTIME_DEV_TOKEN.
 *
 * WHY THIS IS OPT-IN. Both ambient sources used to be reachable purely by being configured, with no
 * environmental condition anywhere: lib/keycloak-token.ts gates minting on the presence of the four
 * KEYCLOAK_* vars, never on NODE_ENV, and the dev token was a bare `process.env` read. That is not a
 * dev-only path in practice — start-prod.mjs sets NODE_ENV=production together with the full
 * KEYCLOAK_* set, so a production-mode build minted service tokens for anonymous callers. Keying the
 * guard on NODE_ENV would therefore have guarded nothing; it has to be an explicit opt-in that a
 * real deployment simply does not set, so the default everywhere is fail-closed.
 *
 * It is NOT removed outright because the two local demo launchers document a deliberate dependency
 * on self-minting ("LOCAL DEMO ONLY" — start-live.mjs, start-prod.mjs); they set the flag. Nothing
 * outside docs/design/web-kit references either source (`git grep TENANT_RUNTIME_DEV_TOKEN`).
 *
 * Defence in depth, not the primary gate: middleware.ts already 401s an anonymous /api request
 * before any handler runs, so a request that gets this far normally carries a caller credential and
 * never consults an ambient one. This second layer is what holds if middleware is bypassed — a
 * mis-scoped matcher, a wrongly-exempted route, or a middleware-bypass bug in the framework.
 */
export function ambientServiceTokenAllowed(): boolean {
  const flag = process.env.HROBOT_ALLOW_AMBIENT_TOKEN
  return flag === '1' || flag === 'true'
}

/**
 * Bearer token to forward, or null if the caller supplied none and ambient credentials are off.
 *
 * Exported because the STT service (app/api/voice/transcribe) is a DIFFERENT backend that needs the
 * IDENTICAL bearer resolution — its FastAPI dependency verifies the same Keycloak token and derives
 * the same tenant from `iss` (stt-service/app/deps.py). Reusing this keeps one resolution order in
 * the codebase instead of a second, slowly-diverging copy.
 */
export async function resolveAuthorization(req: Request): Promise<ResolvedAuth | null> {
  // Caller-supplied credential (Authorization header, then the hrobot_token cookie), read through
  // the same helper the middleware gate uses so the two layers can never disagree about whether a
  // request is anonymous.
  const caller = readCallerCredential(req)
  if (caller) return caller

  // From here on the caller proved nothing. Anything we forward would be OUR credential, so stop
  // unless this process was explicitly told it may do that.
  if (!ambientServiceTokenAllowed()) return null

  // Mint (or reuse a cached) Keycloak token via the direct grant. Returns null when the four
  // KEYCLOAK_* env vars are unset, so we fall through to the legacy static token below.
  const minted = await getKeycloakToken()
  if (minted) return { authorization: `Bearer ${minted}`, source: 'minted' }

  const devToken = process.env.TENANT_RUNTIME_DEV_TOKEN
  if (devToken) return { authorization: `Bearer ${devToken}`, source: 'dev' }

  return null
}

// DELETE is included because `DELETE /uzytkownicy/:userId/roles` (revokeRole) carries its
// `{role, unitId}` selector as the request BODY, not a path/query param (mirrors the DTO
// `RoleAssignmentDto` shared with the POST grant route) — see UsersController.revokeRole. Every
// prior DELETE proxied here (grafik shifts/demands/templates) sends no body, so including DELETE is a
// pure superset: `req.text()` on a bodyless DELETE just resolves to `''`, forwarded as an empty string.
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Forward `req` to `${TENANT_RUNTIME_URL}/${backendPath}${search}`, preserving method/body and
 * attaching the resolved bearer token. Returns the upstream response verbatim (status + body), or
 * a 401 when no token could be resolved / a 502 when the backend is unreachable.
 */
export async function proxyToTenantRuntime(req: Request, backendPath: string, search = ''): Promise<Response> {
  const resolved = await resolveAuthorization(req)
  if (!resolved) {
    return Response.json(
      {
        error: 'unauthenticated',
        message:
          'No caller credential to forward. Send an Authorization header or an hrobot_token cookie. ' +
          '(Ambient service tokens — a minted KEYCLOAK_* token or TENANT_RUNTIME_DEV_TOKEN — are only ' +
          'used when HROBOT_ALLOW_AMBIENT_TOKEN is set, which is for local demos only.)',
      },
      { status: 401 },
    )
  }

  const url = `${tenantRuntimeBaseUrl()}/${backendPath}${search}`
  const hasBody = METHODS_WITH_BODY.has(req.method)
  const body = hasBody ? await req.text() : undefined

  const sendOnce = (authorization: string): Promise<Response> =>
    fetch(url, {
      method: req.method,
      headers: {
        authorization,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    })

  let upstream: Response
  try {
    upstream = await sendOnce(resolved.authorization)

    // A minted token can expire between our skew check and arrival; re-mint once.
    if (upstream.status === 401 && resolved.source === 'minted') {
      const refreshed = await getKeycloakToken(true)
      if (refreshed) upstream = await sendOnce(`Bearer ${refreshed}`)
    }

    // A cookie (logged-in user) token that 401s: rotate it with the refresh token, retry, and
    // re-set both cookies so the session continues instead of bouncing to /login.
    if (upstream.status === 401 && resolved.source === 'cookie') {
      const rc = req.headers.get('cookie')
      const rm = rc ? /(?:^|;\s*)hrobot_refresh=([^;]+)/.exec(rc) : null
      const rotated = rm ? await refreshAccessToken(decodeURIComponent(rm[1])) : null
      const store = await cookies()
      if (rotated) {
        upstream = await sendOnce(`Bearer ${rotated.accessToken}`)
        const base = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' }
        store.set(SESSION_COOKIE, rotated.accessToken, { ...base, maxAge: rotated.refreshExpiresIn })
        store.set(REFRESH_COOKIE, rotated.refreshToken, { ...base, maxAge: rotated.refreshExpiresIn })
      } else {
        // Refresh unavailable or rejected → the session is truly over. Clear both cookies so the next
        // navigation hits middleware with no cookie and is re-gated to /login, instead of leaving the
        // user on a stale 401 screen for the length of the (now longer) cookie TTL.
        store.delete(SESSION_COOKIE)
        store.delete(REFRESH_COOKIE)
      }
    }
  } catch (err) {
    return Response.json(
      {
        error: 'upstream_unreachable',
        message: `Could not reach tenant-runtime at ${tenantRuntimeBaseUrl()}. Is the compose stack up?`,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    )
  }

  // Pass the body + status through unchanged so the client sees real backend errors (400 validation,
  // 403 RBAC, 409, INFEASIBLE payloads, …) rather than a flattened generic error.
  //
  // Read as raw bytes (`.arrayBuffer()`), NOT `.text()`: `dokumenty/:id/pobierz` (see
  // app/api/dokumenty/[[...path]]) streams a binary PDF, and `.text()` runs the body through a
  // TextDecoder that mangles non-UTF-8 bytes. An ArrayBuffer round-trips JSON/text bodies exactly as
  // before, so this is a pure superset of the previous behaviour — every other proxied route (JSON)
  // is unaffected. Also forward `content-disposition` when the upstream set one (the `pobierz` route's
  // `attachment; filename=...`) so the browser downloads with the right filename instead of dropping it.
  const bytes = await upstream.arrayBuffer()
  const headers: Record<string, string> = {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  }
  const disposition = upstream.headers.get('content-disposition')
  if (disposition) headers['content-disposition'] = disposition
  return new Response(bytes, { status: upstream.status, headers })
}

/** Join a catch-all `path` segment array into a backend sub-path, dropping empties. */
export function joinBackendPath(prefix: string, segments: string[]): string {
  const tail = segments.filter(Boolean).join('/')
  return tail ? `${prefix}/${tail}` : prefix
}
