import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PUBLICZNE_API, apiRequestIsAllowed, isApiPath, isPublicApiPath, readCallerCredential } from './api-gate'

/**
 * ARCHITECTURAL GUARD for the BFF, the sibling of lib/middleware-matcher.test.ts (which guards the
 * SCREENS).
 *
 * WHY THIS EXISTS. Every route under app/api/ proxies to tenant-runtime with a bearer resolved by
 * lib/tenant-runtime.ts, whose chain ends in ambient service credentials. Before this branch the
 * middleware matcher had no /api entry and not one of the 17 handlers checked a session, so against
 * the LIVE stack an anonymous `GET /api/employees` answered 200 with 39 employee records and
 * `GET /api/analityk?od=…&do=…` answered 200 with tenant-wide HR aggregates — while the backend hit
 * directly answered 401. The BFF was lending its own service token to anonymous callers.
 *
 * The gate is now default-closed (`/api/:path*` in the matcher), which fixes the recurrence mode
 * that bit the screens three times: a NEW route is protected automatically. What can still rot is
 * the EXEMPTION list, so that is what this file pins — exactly, in both directions.
 */

const webKitRoot = fileURLToPath(new URL('..', import.meta.url))

/** Every `route.ts` under app/api/, as the URL path it serves (dynamic segments kept verbatim). */
function apiRoutes(): string[] {
  const found: string[] = []
  const walk = (relative: string) => {
    for (const entry of readdirSync(`${webKitRoot}app/api${relative}`, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${relative}/${entry.name}`)
      else if (entry.name === 'route.ts') found.push(`/api${relative}`)
    }
  }
  walk('')
  return found.sort()
}

/** The quoted entries listed in the middleware matcher, verbatim (e.g. `/api/:path*`). */
function matcherEntries(): string[] {
  const src = readFileSync(`${webKitRoot}middleware.ts`, 'utf8')
  const block = /matcher:\s*\[([\s\S]*?)\]/.exec(src)
  if (!block) throw new Error('middleware.ts: matcher array not found')
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

/**
 * API routes that are ALLOWED to answer without a session. Must match the real, discovered set
 * EXACTLY: adding a route under an exempt prefix, or leaving a stale entry after a route is deleted,
 * fails this test. Each is a pre-authentication step of the signup flow that reaches no backend —
 * the justification per route lives on PUBLICZNE_API in api-gate.ts.
 */
const OCZEKIWANE_PUBLICZNE = [
  '/api/auth/signup',
  '/api/provision/status/[jobId]',
  '/api/slugs/check/[slug]',
] as const

describe('BFF gate ↔ app/api parity', () => {
  it('the middleware matcher covers the whole /api surface', () => {
    expect(matcherEntries()).toContain('/api/:path*')
  })

  it('every route under app/api is gated except the documented public ones', () => {
    const publiczne = apiRoutes().filter((r) => isPublicApiPath(r))
    expect(publiczne).toEqual([...OCZEKIWANE_PUBLICZNE])
  })

  it('every route under app/api is either gated or public — nothing falls between', () => {
    for (const route of apiRoutes()) {
      expect(isApiPath(route)).toBe(true)
      const gated = !isPublicApiPath(route)
      const publiczna = isPublicApiPath(route)
      expect(gated !== publiczna).toBe(true)
    }
  })

  it('[SELF-CLEANING] every PUBLICZNE_API prefix still names a real route', () => {
    // Fails when a public route is deleted or renamed but its exemption is left behind, so the
    // exemption list cannot rot into a silently-wider hole than anyone intended.
    for (const prefix of PUBLICZNE_API) {
      expect(apiRoutes().some((r) => r === prefix || r.startsWith(`${prefix}/`))).toBe(true)
    }
  })

  it('the routes it checks are the real ones, not a hardcoded guess', () => {
    // Sanity: if discovery broke, every assertion above would pass vacuously.
    const routes = apiRoutes()
    expect(routes.length).toBeGreaterThanOrEqual(17)
    expect(routes).toContain('/api/analityk/[[...path]]')
    expect(routes).toContain('/api/employees/[[...path]]')
    expect(routes).toContain('/api/voice/transcribe')
  })

  it('the tenant-data proxies are NOT public', () => {
    // The routes the reviewer's report named, pinned individually so a careless PUBLICZNE_API edit
    // cannot quietly re-open them.
    for (const route of [
      '/api/analityk',
      '/api/employees',
      '/api/uzytkownicy',
      '/api/dokumenty',
      '/api/wnioski',
      '/api/dostepy',
      '/api/koszty',
      '/api/ustawienia',
      '/api/strategic-brain',
      '/api/shift-swap',
      '/api/ai-grafik',
      '/api/agent-glosowy',
      '/api/grafik/shifts',
      '/api/voice/transcribe',
    ]) {
      expect(isPublicApiPath(route)).toBe(false)
    }
  })
})

describe('isApiPath', () => {
  it('matches the bare /api and everything below it', () => {
    expect(isApiPath('/api')).toBe(true)
    expect(isApiPath('/api/analityk')).toBe(true)
    expect(isApiPath('/api/analityk/absencje')).toBe(true)
  })

  it('does not match screens whose name merely starts with "api"', () => {
    expect(isApiPath('/apixyz')).toBe(false)
    expect(isApiPath('/dashboard')).toBe(false)
  })
})

describe('isPublicApiPath', () => {
  it('covers an exempt prefix and its sub-paths', () => {
    expect(isPublicApiPath('/api/slugs')).toBe(true)
    expect(isPublicApiPath('/api/slugs/check/acme')).toBe(true)
    expect(isPublicApiPath('/api/provision/status/job-1')).toBe(true)
    expect(isPublicApiPath('/api/auth/signup')).toBe(true)
  })

  it('does not leak to a sibling that merely shares a prefix string', () => {
    expect(isPublicApiPath('/api/slugsecret')).toBe(false)
    expect(isPublicApiPath('/api/auth/signup-admin')).toBe(false)
    expect(isPublicApiPath('/api/auth')).toBe(false)
  })
})

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/analityk', { headers })
}

describe('readCallerCredential', () => {
  it('returns null for an anonymous request', () => {
    expect(readCallerCredential(req())).toBeNull()
  })

  it('prefers the Authorization header', () => {
    expect(readCallerCredential(req({ authorization: 'Bearer h', cookie: 'hrobot_token=c' }))).toEqual({
      authorization: 'Bearer h',
      source: 'header',
    })
  })

  it('reads the hrobot_token cookie out of a multi-cookie header', () => {
    expect(readCallerCredential(req({ cookie: 'other=1; hrobot_token=jwt; x=2' }))).toEqual({
      authorization: 'Bearer jwt',
      source: 'cookie',
    })
  })

  it('ignores a different cookie whose name ends in hrobot_token', () => {
    expect(readCallerCredential(req({ cookie: 'not_hrobot_token=jwt' }))).toBeNull()
  })

  it('fails closed on a cookie that cannot be percent-decoded', () => {
    expect(readCallerCredential(req({ cookie: 'hrobot_token=%zz' }))).toBeNull()
  })
})

describe('apiRequestIsAllowed', () => {
  it('REJECTS an anonymous request to a tenant-data proxy', () => {
    expect(apiRequestIsAllowed('/api/analityk', req())).toBe(false)
  })

  it('allows the same route once a session cookie is present', () => {
    expect(apiRequestIsAllowed('/api/analityk', req({ cookie: 'hrobot_token=jwt' }))).toBe(true)
  })

  it('allows a caller-supplied Authorization header (tenant-runtime still validates it)', () => {
    expect(apiRequestIsAllowed('/api/analityk', req({ authorization: 'Bearer x' }))).toBe(true)
  })

  it('allows the pre-authentication signup routes with no credential at all', () => {
    expect(apiRequestIsAllowed('/api/auth/signup', req())).toBe(true)
    expect(apiRequestIsAllowed('/api/slugs/check/acme', req())).toBe(true)
    expect(apiRequestIsAllowed('/api/provision/status/job-1', req())).toBe(true)
  })
})
