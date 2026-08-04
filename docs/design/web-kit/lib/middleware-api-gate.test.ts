import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { middleware } from '../middleware'

/**
 * Exercises the REAL exported `middleware()` — not a restatement of its rule — for the /api half of
 * the gate. lib/api-gate.test.ts pins the policy (which routes are exempt); this file pins that the
 * middleware actually applies it, and that the two halves of the app answer in the right shape.
 *
 * BEFORE THIS BRANCH every assertion in the "gated" block below failed: the matcher had no /api
 * entry, so `middleware()` was never invoked for an API path at all and each of these routes
 * answered 200 with tenant data for an anonymous caller.
 */

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(`http://localhost:5601${path}`, { headers }))
}

/** Every tenant-data proxy under app/api — the surface the reviewer found open. */
const CHRONIONE = [
  '/api/analityk',
  '/api/analityk/absencje',
  '/api/employees',
  '/api/employees/emp-1',
  '/api/uzytkownicy',
  '/api/dokumenty',
  '/api/dokumenty/doc-1/pobierz',
  '/api/wnioski',
  '/api/dostepy',
  '/api/koszty/week',
  '/api/ustawienia/company',
  '/api/strategic-brain/overview',
  '/api/shift-swap',
  '/api/ai-grafik/config',
  '/api/agent-glosowy/interpret',
  '/api/grafik/shifts',
  '/api/voice/transcribe',
]

describe('middleware — /api is closed to anonymous callers', () => {
  it.each(CHRONIONE)('401s an anonymous request to %s', async (path) => {
    const res = middleware(request(path))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthenticated' })
  })

  it('answers 401 rather than redirecting — an API caller needs a status, not a login page', () => {
    const res = middleware(request('/api/analityk'))
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  it('rejects BEFORE the token chain is consulted — a fully configured service credential changes nothing', () => {
    // The invariant is not "answers 401 for some reason" but "is turned away before anything reaches
    // for a service token". Configure every ambient source, including the opt-in flag, and the
    // anonymous answer must be identical: middleware never touches lib/tenant-runtime.ts.
    const saved = { ...process.env }
    try {
      process.env.HROBOT_ALLOW_AMBIENT_TOKEN = '1'
      process.env.TENANT_RUNTIME_DEV_TOKEN = 'a-perfectly-valid-service-token'
      process.env.KEYCLOAK_TOKEN_URL = 'http://kc.test/realms/hrobot-staging/protocol/openid-connect/token'
      process.env.KEYCLOAK_CLIENT_ID = 'hrobot-web'
      process.env.KEYCLOAK_USERNAME = 'demo'
      process.env.KEYCLOAK_PASSWORD = 'pw'
      const res = middleware(request('/api/employees'))
      expect(res.status).toBe(401)
      expect(res.headers.get('x-middleware-next')).toBeNull()
    } finally {
      process.env = saved
    }
  })

  it('never lets an anonymous /api request reach the handler', () => {
    // NextResponse.next() carries the internal rewrite header that tells Next to continue to the
    // route handler; a 401 body response does not. Asserting on the status alone would not
    // distinguish "blocked here" from "handler answered 401", and the whole point of this defect is
    // that the handler must not run.
    const blocked = middleware(request('/api/analityk'))
    const passed = middleware(request('/api/analityk', { cookie: 'hrobot_token=jwt' }))
    expect(blocked.headers.get('x-middleware-next')).toBeNull()
    expect(passed.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('middleware — /api stays open to legitimate callers', () => {
  it.each(CHRONIONE)('lets %s through with a session cookie', (path) => {
    const res = middleware(request(path, { cookie: 'hrobot_token=jwt' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('lets a caller-supplied Authorization header through (tenant-runtime validates it upstream)', () => {
    const res = middleware(request('/api/analityk', { authorization: 'Bearer caller-jwt' }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('finds the cookie among others', () => {
    const res = middleware(request('/api/analityk', { cookie: 'ab=1; hrobot_token=jwt; cd=2' }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('middleware — the pre-authentication signup routes stay public', () => {
  it.each(['/api/auth/signup', '/api/slugs/check/acme', '/api/provision/status/job-1'])(
    'lets %s through with no credential',
    (path) => {
      const res = middleware(request(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-next')).toBe('1')
    },
  )
})

describe('middleware — tenant screens keep redirecting (unchanged)', () => {
  it('redirects an anonymous screen request to /login', () => {
    const res = middleware(request('/analiza'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('lets a screen through with the session cookie', () => {
    const res = middleware(request('/analiza', { cookie: 'hrobot_token=jwt' }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})
