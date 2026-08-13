import { describe, it, expect, vi, afterEach } from 'vitest'
import { refreshAccessToken } from './refresh-token'

afterEach(() => vi.restoreAllMocks())

describe('refreshAccessToken', () => {
  it('exchanges a refresh token for new tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'A2', refresh_token: 'R2', expires_in: 300, refresh_expires_in: 1800 }), { status: 200 })
    ))
    const out = await refreshAccessToken('R1')
    expect(out).toEqual({ accessToken: 'A2', refreshToken: 'R2', expiresIn: 300, refreshExpiresIn: 1800 })
  })

  it('returns null when Keycloak rejects the refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })))
    expect(await refreshAccessToken('expired')).toBeNull()
  })

  it('keeps the old refresh token when the response omits a new one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'A2', expires_in: 300 }), { status: 200 })
    ))
    const out = await refreshAccessToken('R1')
    expect(out?.refreshToken).toBe('R1')
  })
})
