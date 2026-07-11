import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { joinBackendPath, proxyToTenantRuntime, tenantRuntimeBaseUrl } from './tenant-runtime'
import { __resetKeycloakTokenCacheForTests } from './keycloak-token'

const ORIGINAL_ENV = { ...process.env }

const KEYCLOAK_ENV_KEYS = ['KEYCLOAK_TOKEN_URL', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_USERNAME', 'KEYCLOAK_PASSWORD']

function setKeycloakCreds() {
  process.env.KEYCLOAK_TOKEN_URL = 'http://kc.test/realms/hrobot-staging/protocol/openid-connect/token'
  process.env.KEYCLOAK_CLIENT_ID = 'hrobot-web'
  process.env.KEYCLOAK_USERNAME = 'demo'
  process.env.KEYCLOAK_PASSWORD = 'secret-pw'
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

  it('falls back to TENANT_RUNTIME_DEV_TOKEN', async () => {
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'dev-service-token'
    const fetchFn = mockFetch(200, [])
    await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer dev-service-token' })
  })

  it('prefers the header over cookie and env', async () => {
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'dev'
    const fetchFn = mockFetch(200, [])
    const req = new Request('http://localhost/api/grafik/shifts', {
      headers: { authorization: 'Bearer header-wins', cookie: 'hrobot_token=cookie' },
    })
    await proxyToTenantRuntime(req, 'grafik/shifts')
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer header-wins' })
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

describe('proxyToTenantRuntime — minted Keycloak token', () => {
  it('mints a Keycloak token and forwards it when no header/cookie is present', async () => {
    setKeycloakCreds()
    const fetchFn = mockKeycloakAndBackend(200, [{ id: 's1' }])
    const res = await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    expect(res.status).toBe(200)
    const backendCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/grafik/shifts'))!
    expect((backendCall[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer minted-jwt' })
  })

  it('prefers the caller header + cookie over a minted token', async () => {
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
    setKeycloakCreds()
    process.env.TENANT_RUNTIME_DEV_TOKEN = 'legacy-static'
    const fetchFn = mockKeycloakAndBackend(200, [])
    await proxyToTenantRuntime(new Request('http://localhost/api/grafik/shifts'), 'grafik/shifts')
    const backendCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/grafik/shifts'))!
    expect((backendCall[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer minted-jwt' })
  })

  it('force-refreshes + retries once on a backend 401 for a minted token', async () => {
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
