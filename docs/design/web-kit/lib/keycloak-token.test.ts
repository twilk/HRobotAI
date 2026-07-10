import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetKeycloakTokenCacheForTests, getKeycloakToken } from './keycloak-token'

const ORIGINAL_ENV = { ...process.env }

const CREDS = {
  KEYCLOAK_TOKEN_URL: 'http://kc.test/realms/hrobot-staging/protocol/openid-connect/token',
  KEYCLOAK_CLIENT_ID: 'hrobot-web',
  KEYCLOAK_USERNAME: 'demo',
  KEYCLOAK_PASSWORD: 'secret-pw',
}

function setCreds() {
  Object.assign(process.env, CREDS)
}

/** A fetch mock that returns a token response; the access_token is derived from a call counter so
 *  successive mints are distinguishable. */
function mockTokenFetch(expiresIn = 300, status = 200) {
  let n = 0
  const fn = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    n += 1
    return new Response(JSON.stringify({ access_token: `tok-${n}`, expires_in: expiresIn }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  __resetKeycloakTokenCacheForTests()
  for (const k of Object.keys(CREDS)) delete process.env[k]
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

describe('getKeycloakToken — disabled when creds unset', () => {
  it('returns null and does NOT hit Keycloak when the KEYCLOAK_* vars are missing', async () => {
    const fetchFn = mockTokenFetch()
    expect(await getKeycloakToken()).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns null when only some of the four vars are set', async () => {
    const fetchFn = mockTokenFetch()
    process.env.KEYCLOAK_TOKEN_URL = CREDS.KEYCLOAK_TOKEN_URL
    process.env.KEYCLOAK_CLIENT_ID = CREDS.KEYCLOAK_CLIENT_ID
    // username + password intentionally missing
    expect(await getKeycloakToken()).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('getKeycloakToken — mint + direct-grant request shape', () => {
  it('mints via a form-encoded password grant and returns the access_token', async () => {
    setCreds()
    const fetchFn = mockTokenFetch()
    const token = await getKeycloakToken()
    expect(token).toBe('tok-1')

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(CREDS.KEYCLOAK_TOKEN_URL)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')

    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('password')
    expect(body.get('client_id')).toBe(CREDS.KEYCLOAK_CLIENT_ID)
    expect(body.get('username')).toBe(CREDS.KEYCLOAK_USERNAME)
    expect(body.get('password')).toBe(CREDS.KEYCLOAK_PASSWORD)
  })
})

describe('getKeycloakToken — caching', () => {
  it('caches: a second call within the TTL does NOT re-mint', async () => {
    setCreds()
    const fetchFn = mockTokenFetch(300)
    expect(await getKeycloakToken()).toBe('tok-1')
    expect(await getKeycloakToken()).toBe('tok-1')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refreshes after expiry (cache goes stale past the skew window)', async () => {
    setCreds()
    const fetchFn = mockTokenFetch(300)
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)

    expect(await getKeycloakToken()).toBe('tok-1')
    // Advance beyond (ttl - skew) = 300s - 60s = 240s → cache is stale.
    clock += 241_000
    expect(await getKeycloakToken()).toBe('tok-2')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('does NOT refresh just before the skew boundary', async () => {
    setCreds()
    const fetchFn = mockTokenFetch(300)
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)

    expect(await getKeycloakToken()).toBe('tok-1')
    clock += 239_000 // still inside the fresh window (< 240s)
    expect(await getKeycloakToken()).toBe('tok-1')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('forceRefresh bypasses a still-fresh cache', async () => {
    setCreds()
    const fetchFn = mockTokenFetch(300)
    expect(await getKeycloakToken()).toBe('tok-1')
    expect(await getKeycloakToken(true)).toBe('tok-2')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('getKeycloakToken — concurrency de-dup', () => {
  it('dedupes concurrent mints into a single Keycloak request', async () => {
    setCreds()
    let resolveFetch: (r: Response) => void = () => {}
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchFn)

    const p1 = getKeycloakToken()
    const p2 = getKeycloakToken()
    const p3 = getKeycloakToken()
    expect(fetchFn).toHaveBeenCalledTimes(1)

    resolveFetch(
      new Response(JSON.stringify({ access_token: 'tok-shared', expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(await Promise.all([p1, p2, p3])).toEqual(['tok-shared', 'tok-shared', 'tok-shared'])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('getKeycloakToken — error handling', () => {
  it('returns null on a non-2xx from Keycloak (and does not cache)', async () => {
    setCreds()
    const fetchFn = mockTokenFetch(300, 401)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getKeycloakToken()).toBeNull()
    // A later success still mints (nothing bad cached).
    fetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok-later', expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(await getKeycloakToken()).toBe('tok-later')
  })

  it('returns null when Keycloak is unreachable', async () => {
    setCreds()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    expect(await getKeycloakToken()).toBeNull()
  })

  it('never logs the password or the minted token', async () => {
    setCreds()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTokenFetch(300, 500)
    await getKeycloakToken()
    const logged = errSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain(CREDS.KEYCLOAK_PASSWORD)
  })
})
