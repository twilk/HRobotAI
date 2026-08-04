import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { joinBackendPath, proxyToTenantRuntime, tenantRuntimeBaseUrl } from './tenant-runtime'
import { __resetKeycloakTokenCacheForTests } from './keycloak-token'

// The cookie-401→refresh path re-sets the session/refresh cookies via next/headers cookies().set().
// Mock the module so that mutable-cookie call works under vitest; the spy lets us assert on it.
// The other paths in this file never reach cookies() (they 200 or use header/dev/minted tokens).
const { cookieSetSpy, cookieDeleteSpy } = vi.hoisted(() => ({ cookieSetSpy: vi.fn(), cookieDeleteSpy: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSetSpy, get: vi.fn(), delete: cookieDeleteSpy })),
}))

const ORIGINAL_ENV = { ...process.env }

const KEYCLOAK_ENV_KEYS = ['KEYCLOAK_TOKEN_URL', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_USERNAME', 'KEYCLOAK_PASSWORD']

function setKeycloakCreds() {
  process.env.KEYCLOAK_TOKEN_URL = 'http://kc.test/realms/hrobot-staging/protocol/openid-connect/token'
  process.env.KEYCLOAK_CLIENT_ID = 'hrobot-web'
  process.env.KEYCLOAK_USERNAME = 'demo'
  process.env.KEYCLOAK_PASSWORD = 'secret-pw'
}

/**
 * Opt in to the AMBIENT (server-owned) token sources. They are off by default now — see
 * ambientServiceTokenAllowed() — so the tests below that exercise minting / TENANT_RUNTIME_DEV_TOKEN
 * must enable them explicitly, exactly as the local demo launchers do. The "refuses …" cases
 * deliberately do NOT call this.
 */
function allowAmbientToken() {
  process.env.HROBOT_ALLOW_AMBIENT_TOKEN = '1'
}

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  const fn = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
    typeof body === 'string'
      ? new Response(body, { status, headers: { 'content-type': contentType } })
      : new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  delete process.env.TENANT_RUNTIME_URL
  delete process.env.TENANT_RUNTIME_DEV_TOKEN
  delete process.env.HROBOT_ALLOW_AMBIENT_TOKEN
  for (const k of KEYCLOAK_ENV_KEYS) delete process.env[k]
  __resetKeycloakTokenCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('tenantRuntimeBaseUrl', () => {
  it('defaults to localhost:3001', () => {
    expect(tenantRuntimeBaseUrl()).toBe('http://localhost:3001')
  })

  it('honours TENANT_RUNTIME_URL and strips trailing slashes', () => {
    process.env.TENANT_RUNTIME_URL = 'http://tenant-runtime:3001/'
    expect(tenantRuntimeBaseUrl()).toBe('http://tenant-runtime:3001')
  })
})

describe('joinBackendPath', () => {
  it('appends non-empty segments', () => {
    expect(joinBackendPath('grafik', ['shifts'])).toBe('grafik/shifts')
    expect(joinBackendPath('grafik', ['shifts', 'abc-123'])).toBe('grafik/shifts/abc-123')
  })

  it('drops empty segments and bare prefixes', () => {
    expect(joinBackendPath('grafik', [])).toBe('grafik')
    expect(joinBackendPath('grafik', [''])).toBe('grafik')
  })
})

describe('proxyToTenantRuntime — auth resolution', () => {
  it('returns 401 and does NOT call the backend when no token is resolvable', async () => {
    const fetchFn = mockFetch(200, [])
    const res = await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    expect(res.status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()
    expect((await res.json()).error).toBe('unauthenticated')
  })

  it('forwards the caller Authorization header verbatim', async () => {
    const fetchFn = mockFetch(200, [{ id: 's1' }])
    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { authorization: 'Bearer real-jwt' },
    })
    const res = await proxyToTenantRuntime(req, 'grafik/shifts')
    expect(res.status).toBe(200)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('http://localhost:3001/grafik/shifts')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer real-jwt' })
  })

  it('falls back to the hrobot_token cookie', async () => {
    const fetchFn = mockFetch(200, [])
    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { cookie: 'other=1; hrobot_token=cookie-jwt; x=2' },
    })
    await proxyToTenantRuntime(req, 'grafik/shifts')
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer cookie-jwt' })
  })

  it('falls back to TENANT_RUNTIME_DEV_TOKEN when ambient tokens are allowed', async () => {
    allowAmbientToken()
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'dev-service-token'
    const fetchFn = mockFetch(200, [])
    await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer dev-service-token' })
  })

  it('prefers the header over cookie and env', async () => {
    allowAmbientToken()
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'dev'
    const fetchFn = mockFetch(200, [])
    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { authorization: 'Bearer header-wins', cookie: 'hrobot_token=cookie' },
    })
    await proxyToTenantRuntime(req, 'grafik/shifts')
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer header-wins' })
  })
})

/**
 * SECOND LINE OF DEFENCE. middleware.ts 401s an anonymous /api request before any handler runs, but
 * that gate is one config edit (or one framework middleware-bypass bug) away from not applying. These
 * cases pin the invariant at the choke point itself: with no caller credential, the proxy does not
 * borrow the server's own identity — it refuses, and the backend is never called.
 *
 * BEFORE THIS BRANCH all four failed: TENANT_RUNTIME_DEV_TOKEN and the minted Keycloak token were
 * bare `process.env` reads with no environmental condition at all, so merely configuring them made
 * anonymous proxying work — including under NODE_ENV=production (start-prod.mjs).
 */
describe('proxyToTenantRuntime — ambient service tokens are opt-in', () => {
  it('refuses TENANT_RUNTIME_DEV_TOKEN when HROBOT_ALLOW_AMBIENT_TOKEN is unset', async () => {
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'dev-service-token'
    const fetchFn = mockFetch(200, [{ pesel: 'nope' }])
    const res = await proxyToTenantRuntime(new Request('http://localhost/api/analityk'), 'analityk')
    expect(res.status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses to mint a Keycloak token when HROBOT_ALLOW_AMBIENT_TOKEN is unset', async () => {
    setKeycloakCreds()
    const fetchFn = mockKeycloakAndBackend(200, [{ pesel: 'nope' }])
    const res = await proxyToTenantRuntime(new Request('http://localhost/api/analityk'), 'analityk')
    expect(res.status).toBe(401)
    // Not even the token endpoint is contacted — the refusal happens before any network call.
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('still refuses when NODE_ENV is production and the demo creds are present', async () => {
    // The exact shape of start-prod.mjs minus the explicit opt-in: a NODE_ENV-keyed guard would have
    // let this through, which is why the guard is a dedicated flag.
    const prev = process.env.NODE_ENV
    try {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true, writable: true })
      setKeycloakCreds()
      process.env.TENANT_RUNTIME_DEV_TOKEN = 'dev-service-token'
      const fetchFn = mockKeycloakAndBackend(200, [])
      const res = await proxyToTenantRuntime(new Request('http://localhost/api/analityk'), 'analityk')
      expect(res.status).toBe(401)
      expect(fetchFn).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: prev, configurable: true, writable: true })
    }
  })

  it('honours the flag only for an explicit 1/true, not any truthy string', async () => {
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'dev-service-token'
    process.env.HROBOT_ALLOW_AMBIENT_TOKEN = '0'
    const fetchFn = mockFetch(200, [])
    expect((await proxyToTenantRuntime(new Request('http://localhost/api/analityk'), 'analityk')).status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()

    process.env.HROBOT_ALLOW_AMBIENT_TOKEN = 'true'
    expect((await proxyToTenantRuntime(new Request('http://localhost/api/analityk'), 'analityk')).status).toBe(200)
  })

  it('a caller credential still works with the flag off — the gate is on ANONYMITY, not on the proxy', async () => {
    const fetchFn = mockFetch(200, [{ id: 'ok' }])
    const req = new Request('http://localhost/api/analityk', { headers: { cookie: 'hrobot_token=real-jwt' } })
    const res = await proxyToTenantRuntime(req, 'analityk')
    expect(res.status).toBe(200)
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer real-jwt' })
  })
})

// A fetch mock that returns a Keycloak token JSON for the token URL and a backend body otherwise, so
// one stub serves both the mint call and the proxied backend call. Returns the recorded calls.
function mockKeycloakAndBackend(backendStatus: number, backendBody: unknown, accessToken = 'minted-jwt') {
  const fn = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    if (String(url).includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: accessToken, expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(backendBody), {
      status: backendStatus,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

// These exercise the ambient minting path, which is opt-in — see the "ambient service tokens are
// opt-in" block above for what happens without the flag.
describe('proxyToTenantRuntime — minted Keycloak token', () => {
  it('mints a Keycloak token and forwards it when no header/cookie is present', async () => {
    allowAmbientToken()
    setKeycloakCreds()
    const fetchFn = mockKeycloakAndBackend(200, [{ id: 's1' }])
    const res = await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    expect(res.status).toBe(200)
    const backendCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/grafik/shifts'))!
    expect((backendCall[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer minted-jwt' })
  })

  it('prefers the caller header + cookie over a minted token', async () => {
    allowAmbientToken()
    setKeycloakCreds()
    const fetchFn = mockKeycloakAndBackend(200, [])
    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { authorization: 'Bearer header-wins' },
    })
    await proxyToTenantRuntime(req, 'grafik/shifts')
    // No mint should happen — only the backend call.
    expect(fetchFn.mock.calls.every((c) => !String(c[0]).includes('/protocol/openid-connect/token'))).toBe(true)
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer header-wins' })
  })

  it('prefers a minted token over the legacy TENANT_RUNTIME_DEV_TOKEN', async () => {
    allowAmbientToken()
    setKeycloakCreds()
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'legacy-static'
    const fetchFn = mockKeycloakAndBackend(200, [])
    await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    const backendCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/grafik/shifts'))!
    expect((backendCall[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer minted-jwt' })
  })

  it('force-refreshes + retries once on a backend 401 for a minted token', async () => {
    allowAmbientToken()
    setKeycloakCreds()
    let mints = 0
    let backendCalls = 0
    const fn = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (String(url).includes('/protocol/openid-connect/token')) {
        mints += 1
        return new Response(JSON.stringify({ access_token: `jwt-${mints}`, expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      backendCalls += 1
      // First backend hit 401s (expired), the retry with the fresh token succeeds.
      const status = backendCalls === 1 ? 401 : 200
      return new Response(JSON.stringify(status === 200 ? [{ id: 'ok' }] : { error: 'expired' }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fn)

    const res = await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    expect(res.status).toBe(200)
    expect(mints).toBe(2) // initial mint + one force-refresh
    expect(backendCalls).toBe(2)
    const secondBackend = fn.mock.calls.filter((c) => String(c[0]).includes('/grafik/shifts'))[1]
    expect((secondBackend[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer jwt-2' })
  })

  it('does NOT retry a caller-supplied header on a 401 (only minted tokens refresh)', async () => {
    const fetchFn = mockFetch(401, { error: 'nope' })
    const req = new Request('http://localhost/api/grafik/shifts', { headers: { authorization: 'Bearer caller' } })
    const res = await proxyToTenantRuntime(req, 'grafik/shifts')
    expect(res.status).toBe(401)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('proxyToTenantRuntime — cookie token refresh rotation', () => {
  it('rotates a stale cookie token on 401: refreshes, retries with the new access token, and re-sets both cookies', async () => {
    cookieSetSpy.mockClear()
    let backendCalls = 0
    const fn = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      // The refresh grant hits the Keycloak token endpoint; return a fresh token pair.
      if (String(url).includes('/protocol/openid-connect/token')) {
        return new Response(
          JSON.stringify({ access_token: 'A2', refresh_token: 'R2', expires_in: 300, refresh_expires_in: 1800 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      backendCalls += 1
      // First backend hit 401s (stale access token); the retry with the rotated token succeeds.
      const status = backendCalls === 1 ? 401 : 200
      return new Response(JSON.stringify(status === 200 ? [{ id: 'ok' }] : { error: 'expired' }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fn)

    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { cookie: 'hrobot_token=stale-jwt; hrobot_refresh=R1' },
    })
    const res = await proxyToTenantRuntime(req, 'grafik/shifts')

    // The session survived: the retried upstream call returned 200, not a bounce to /login.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'ok' }])
    expect(backendCalls).toBe(2)

    // The refresh POST carried the old refresh token via the refresh_token grant.
    const refreshCall = fn.mock.calls.find((c) => String(c[0]).includes('/protocol/openid-connect/token'))!
    expect((refreshCall[1] as RequestInit).body).toContain('grant_type=refresh_token')
    expect((refreshCall[1] as RequestInit).body).toContain('refresh_token=R1')

    // The retry hit the backend with the ROTATED access token, not the stale one.
    const backendHits = fn.mock.calls.filter((c) => String(c[0]).includes('/grafik/shifts'))
    expect((backendHits[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer stale-jwt' })
    expect((backendHits[1][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer A2' })

    // Both cookies were re-set so the browser carries the rotated pair forward.
    const setNames = cookieSetSpy.mock.calls.map((c) => c[0])
    expect(setNames).toContain('hrobot_token')
    expect(setNames).toContain('hrobot_refresh')
    const tokenSet = cookieSetSpy.mock.calls.find((c) => c[0] === 'hrobot_token')!
    const refreshSet = cookieSetSpy.mock.calls.find((c) => c[0] === 'hrobot_refresh')!
    expect(tokenSet[1]).toBe('A2')
    expect(refreshSet[1]).toBe('R2')
  })

  it('does NOT rotate when the cookie carries no hrobot_refresh (nothing to refresh with)', async () => {
    cookieSetSpy.mockClear()
    const fetchFn = mockFetch(401, { error: 'expired' })
    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { cookie: 'hrobot_token=stale-jwt' },
    })
    const res = await proxyToTenantRuntime(req, 'grafik/shifts')
    expect(res.status).toBe(401)
    expect(fetchFn).toHaveBeenCalledTimes(1) // no refresh POST, no retry
    expect(cookieSetSpy).not.toHaveBeenCalled()
  })

  it('clears both cookies and returns 401 when the refresh token is rejected', async () => {
    cookieSetSpy.mockClear()
    cookieDeleteSpy.mockClear()
    let backendCalls = 0
    const fn = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      // Keycloak rejects the (revoked / expired) refresh token → refreshAccessToken returns null.
      if (String(url).includes('/protocol/openid-connect/token')) {
        return new Response('{"error":"invalid_grant"}', {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      backendCalls += 1
      return new Response(JSON.stringify({ error: 'expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fn)

    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { cookie: 'hrobot_token=stale-jwt; hrobot_refresh=dead-refresh' },
    })
    const res = await proxyToTenantRuntime(req, 'grafik/shifts')

    // The stale 401 passes through — no retry with a new bearer happened.
    expect(res.status).toBe(401)
    expect(backendCalls).toBe(1)

    // Session is over: both cookies cleared (so the next navigation is re-gated to /login), none re-set.
    expect(cookieSetSpy).not.toHaveBeenCalled()
    const deletedNames = cookieDeleteSpy.mock.calls.map((c) => c[0])
    expect(deletedNames).toContain('hrobot_token')
    expect(deletedNames).toContain('hrobot_refresh')
  })
})

describe('proxyToTenantRuntime — forwarding', () => {
  it('uses the compose base URL and preserves the query string', async () => {
    process.env.TENANT_RUNTIME_URL = 'http://tenant-runtime:3001'
    const fetchFn = mockFetch(200, [])
    const req = new Request('http://localhost/api/grafik/shifts?foo=bar', {
      headers: { authorization: 'Bearer t' },
    })
    await proxyToTenantRuntime(req, 'grafik/shifts', new URL(req.url).search)
    expect(fetchFn.mock.calls[0][0]).toBe('http://tenant-runtime:3001/grafik/shifts?foo=bar')
  })

  it('forwards a POST body with a JSON content-type', async () => {
    const fetchFn = mockFetch(201, { id: 'new' })
    const req = new Request('http://localhost/api/grafik/shifts', {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: JSON.stringify({ role: 'Operator' }),
    })
    const res = await proxyToTenantRuntime(req, 'grafik/shifts')
    expect(res.status).toBe(201)
    const init = fetchFn.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ role: 'Operator' }))
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
  })

  it('forwards a DELETE body with a JSON content-type (e.g. uzytkownicy revokeRole)', async () => {
    const fetchFn = mockFetch(200, {})
    const req = new Request('http://localhost/api/uzytkownicy/u1/roles', {
      method: 'DELETE',
      headers: { authorization: 'Bearer t' },
      body: JSON.stringify({ role: 'MANAGER', unitId: 'unit-1' }),
    })
    const res = await proxyToTenantRuntime(req, 'uzytkownicy/u1/roles')
    expect(res.status).toBe(200)
    const init = fetchFn.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('DELETE')
    expect(init.body).toBe(JSON.stringify({ role: 'MANAGER', unitId: 'unit-1' }))
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' })
  })

  it('passes the upstream status + body through unchanged (e.g. INFEASIBLE / validation errors)', async () => {
    mockFetch(200, { status: 'INFEASIBLE', unmet: [{ demandId: 'd1', reason: 'no qualified staff' }] })
    const req = new Request('http://localhost/api/grafik/solve', {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: '{}',
    })
    const res = await proxyToTenantRuntime(req, 'grafik/solve')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'INFEASIBLE' })
  })

  it('returns 502 when the backend is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const req = new Request('http://localhost/api/grafik/shifts', { headers: { authorization: 'Bearer t' } })
    const res = await proxyToTenantRuntime(req, 'grafik/shifts')
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('upstream_unreachable')
  })
})
