import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { joinBackendPath, proxyToTenantRuntime, tenantRuntimeBaseUrl } from './tenant-runtime'

const ORIGINAL_ENV = { ...process.env }

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
