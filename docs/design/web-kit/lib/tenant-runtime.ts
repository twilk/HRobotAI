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

/** Base URL of the tenant-runtime service. Local dev default; override for the compose network. */
export function tenantRuntimeBaseUrl(): string {
  const raw = process.env.TENANT_RUNTIME_URL ?? 'http://localhost:3001'
  return raw.replace(/\/+$/, '')
}

/**
 * A resolved bearer plus whether it was minted by the Keycloak provider — only a minted token is
 * worth force-refreshing + retrying on a backend 401 (a caller-supplied header/cookie or the static
 * dev token can't be re-minted here).
 */
interface ResolvedAuth {
  authorization: string
  minted: boolean
}

/** Bearer token to forward, or null if the caller supplied none and nothing else is configured. */
async function resolveAuthorization(req: Request): Promise<ResolvedAuth | null> {
  const header = req.headers.get('authorization')
  if (header) return { authorization: header, minted: false }

  const cookie = req.headers.get('cookie')
  const match = cookie ? /(?:^|;\s*)hrobot_token=([^;]+)/.exec(cookie) : null
  if (match) return { authorization: `Bearer ${decodeURIComponent(match[1])}`, minted: false }

  // Mint (or reuse a cached) Keycloak token via the direct grant. Returns null when the four
  // KEYCLOAK_* env vars are unset, so we fall through to the legacy static token below.
  const minted = await getKeycloakToken()
  if (minted) return { authorization: `Bearer ${minted}`, minted: true }

  const devToken = process.env.TENANT_RUNTIME_DEV_TOKEN
  if (devToken) return { authorization: `Bearer ${devToken}`, minted: false }

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

    // A minted token can expire in the window between our skew check and its arrival at
    // tenant-runtime. On a 401 for a minted token, force a fresh mint once and retry.
    if (upstream.status === 401 && resolved.minted) {
      const refreshed = await getKeycloakToken(true)
      if (refreshed) upstream = await sendOnce(`Bearer ${refreshed}`)
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
