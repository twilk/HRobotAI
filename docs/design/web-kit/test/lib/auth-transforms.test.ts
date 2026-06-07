import { describe, it, expect } from 'vitest'
import { transformJwt, transformSession } from '@/lib/auth'
import type { JWT } from 'next-auth/jwt'
import type { Session } from 'next-auth'

const makeToken = (overrides = {}): JWT => ({
  sub: 'u1', iat: 0, exp: 9999, jti: 'x', ...overrides,
})
const makeSession = (): Session => ({
  user: { name: 'Test', email: 'test@test.com', roles: [] },
  expires: '2099-01-01',
  accessToken: '',
})
const fakeAccount = {
  access_token: 'tok-123',
  token_type: 'Bearer' as const,
  provider: 'keycloak',
  providerAccountId: '1',
  type: 'oidc' as const,
}

describe('transformJwt', () => {
  it('sets accessToken from account.access_token', () => {
    const r = transformJwt(makeToken(), fakeAccount, { hrobot_roles: ['ADMIN_KLIENTA'], sub: '1' })
    expect(r.accessToken).toBe('tok-123')
  })
  it('sets roles from profile.hrobot_roles', () => {
    const r = transformJwt(makeToken(), fakeAccount, { hrobot_roles: ['HR', 'MANAGER'], sub: '1' })
    expect(r.roles).toEqual(['HR', 'MANAGER'])
  })
  it('defaults roles to [] when profile has no hrobot_roles', () => {
    const r = transformJwt(makeToken(), fakeAccount, { sub: '1' })
    expect(r.roles).toEqual([])
  })
  it('defaults accessToken to empty string when access_token missing', () => {
    const r = transformJwt(makeToken(), { ...fakeAccount, access_token: undefined }, {})
    expect(r.accessToken).toBe('')
  })
  it('no-ops when account is null (token refresh path)', () => {
    const t = makeToken({ accessToken: 'existing', roles: ['HR'] })
    const r = transformJwt(t, null, {})
    expect(r.accessToken).toBe('existing')
    expect(r.roles).toEqual(['HR'])
  })
})

describe('transformSession', () => {
  it('copies roles from token to session.user.roles', () => {
    const r = transformSession(makeSession(), makeToken({ roles: ['PRACOWNIK'] }))
    expect(r.user.roles).toEqual(['PRACOWNIK'])
  })
  it('copies accessToken from token to session', () => {
    const r = transformSession(makeSession(), makeToken({ accessToken: 'Bearer xyz' }))
    expect(r.accessToken).toBe('Bearer xyz')
  })
  it('defaults roles to [] when token has no roles', () => {
    const r = transformSession(makeSession(), makeToken())
    expect(r.user.roles).toEqual([])
  })
  it('defaults accessToken to empty string when token lacks it', () => {
    const r = transformSession(makeSession(), makeToken())
    expect(r.accessToken).toBe('')
  })
})
