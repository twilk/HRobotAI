// Server-only proxy to the real tenant-runtime (NestJS) API. Next.js route handlers under
// app/api/grafik/** and app/api/employees call proxyToTenantRuntime() so the browser never talks
// to the backend directly — that keeps the bearer token server-side and sidesteps CORS entirely
// (this is a same-process server→server fetch, not a cross-origin browser request).
//
// AUTH: tenant-runtime derives the tenant from the Keycloak JWT issuer (`iss` → realm `hrobot-<slug>`)
// and gates every route with KeycloakJwtGuard, so all we must do is forward a valid Bearer token.
// web-kit has no login flow yet (login-form.tsx is a mock router.push), so the token is resolved,
// in priority order, from: the caller's Authorization header → an `hrobot_token` cookie → a freshly
// minted Keycloak token (direct grant, see lib/keycloak-token.ts) → the legacy TENANT_RUNTIME_DEV_TOKEN
// env (a static service token). See the PR body.

import { getKeycloakToken } from './keycloak-token'
import { cookies } from 'next/headers'
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

/** Bearer token to forward, or null if the caller supplied none and nothing else is configured. */
async function resolveAuthorization(req: Request): Promise<ResolvedAuth | null> {
  const header = req.headers.get('authorization')
  if (header) return { authorization: header, source: 'header' }

  const cookie = req.headers.get('cookie')
  const match = cookie ? /(?:^|;\s*)hrobot_token=([^;]+)/.exec(cookie) : null
  if (match) return { authorization: `Bearer ${decodeURIComponent(match[1])}`, source: 'cookie' }

  // Mint (or reuse a cached) Keycloak token via the direct grant. Returns null when the four
  // KEYCLOAK_* env vars are unset, so we fall through to the legacy static token below.
  const minted = await getKeycloakToken()
  if (minted) return { authorization: `Bearer ${minted}`, source: 'minted' }

  const devToken = process.env.TENANT_RUNTIME_DEV_TOKEN
  if (devToken) return { authorization: `Bearer ${devToken}`, source: 'dev' }

  return null
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

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
          'No bearer token to forward. Send an Authorization header, set an hrobot_token cookie, configure the KEYCLOAK_* env vars, or set TENANT_RUNTIME_DEV_TOKEN.',
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
  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}

/** Join a catch-all `path` segment array into a backend sub-path, dropping empties. */
export function joinBackendPath(prefix: string, segments: string[]): string {
  const tail = segments.filter(Boolean).join('/')
  return tail ? `${prefix}/${tail}` : prefix
}
