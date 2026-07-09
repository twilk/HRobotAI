// Server-only proxy to the real tenant-runtime (NestJS) API. Next.js route handlers under
// app/api/grafik/** and app/api/employees call proxyToTenantRuntime() so the browser never talks
// to the backend directly — that keeps the bearer token server-side and sidesteps CORS entirely
// (this is a same-process server→server fetch, not a cross-origin browser request).
//
// AUTH: tenant-runtime derives the tenant from the Keycloak JWT issuer (`iss` → realm `hrobot-<slug>`)
// and gates every route with KeycloakJwtGuard, so all we must do is forward a valid Bearer token.
// web-kit has no login flow yet (login-form.tsx is a mock router.push), so the token is resolved,
// in priority order, from: the caller's Authorization header → an `hrobot_token` cookie → the
// TENANT_RUNTIME_DEV_TOKEN env (a service token for compose/UAT). See the PR body.

/** Base URL of the tenant-runtime service. Local dev default; override for the compose network. */
export function tenantRuntimeBaseUrl(): string {
  const raw = process.env.TENANT_RUNTIME_URL ?? 'http://localhost:3001'
  return raw.replace(/\/+$/, '')
}

/** Bearer token to forward, or null if the caller supplied none and no dev token is configured. */
function resolveAuthorization(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (header) return header

  const cookie = req.headers.get('cookie')
  const match = cookie ? /(?:^|;\s*)hrobot_token=([^;]+)/.exec(cookie) : null
  if (match) return `Bearer ${decodeURIComponent(match[1])}`

  const devToken = process.env.TENANT_RUNTIME_DEV_TOKEN
  if (devToken) return `Bearer ${devToken}`

  return null
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Forward `req` to `${TENANT_RUNTIME_URL}/${backendPath}${search}`, preserving method/body and
 * attaching the resolved bearer token. Returns the upstream response verbatim (status + body), or
 * a 401 when no token could be resolved / a 502 when the backend is unreachable.
 */
export async function proxyToTenantRuntime(req: Request, backendPath: string, search = ''): Promise<Response> {
  const authorization = resolveAuthorization(req)
  if (!authorization) {
    return Response.json(
      {
        error: 'unauthenticated',
        message:
          'No bearer token to forward. Send an Authorization header, set an hrobot_token cookie, or configure TENANT_RUNTIME_DEV_TOKEN.',
      },
      { status: 401 },
    )
  }

  const url = `${tenantRuntimeBaseUrl()}/${backendPath}${search}`
  const hasBody = METHODS_WITH_BODY.has(req.method)
  const body = hasBody ? await req.text() : undefined

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers: {
        authorization,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    })
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
