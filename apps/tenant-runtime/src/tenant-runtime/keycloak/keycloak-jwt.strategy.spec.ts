import { Test, TestingModule } from '@nestjs/testing'
import { KeycloakJwtStrategy, JwtPayload } from './keycloak-jwt.strategy.js'

describe('KeycloakJwtStrategy', () => {
  let strategy: KeycloakJwtStrategy

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KeycloakJwtStrategy],
    }).compile()
    strategy = module.get(KeycloakJwtStrategy)
  })

  it('returns the payload unchanged from validate()', () => {
    const payload: JwtPayload = {
      sub: 'user-uuid-1',
      iss: 'http://localhost:8080/realms/hrobot-acme',
      hrobot_roles: ['ADMIN_KLIENTA'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    expect(strategy.validate(payload)).toEqual(payload)
  })

  it('extracts the slug from a realm iss claim', () => {
    const slug = strategy.extractSlug('http://localhost:8080/realms/hrobot-my-company')
    expect(slug).toBe('my-company')
  })

  it('returns empty string when iss does not match realm pattern', () => {
    expect(strategy.extractSlug('http://evil.example.com/other')).toBe('')
  })

  // FIX-P3-1: the JWKS host must be derived from a trusted issuer, never from the raw token.
  it('trusts our Keycloak host + a valid realm slug', () => {
    expect(
      strategy.isTrustedIssuer('http://localhost:8080/realms/hrobot-acme', 'http://localhost:8080'),
    ).toBe(true)
  })

  it('rejects a foreign issuer host (the forged-token / attacker-JWKS bypass)', () => {
    expect(
      strategy.isTrustedIssuer('http://evil.example.com/realms/hrobot-acme', 'http://localhost:8080'),
    ).toBe(false)
  })

  it('rejects our host with a malformed realm (prefix / path injection)', () => {
    expect(
      strategy.isTrustedIssuer('http://localhost:8080/realms/hrobot-acme.evil', 'http://localhost:8080'),
    ).toBe(false)
    expect(
      strategy.isTrustedIssuer('http://localhost:8080/realms/hrobot-acme/extra', 'http://localhost:8080'),
    ).toBe(false)
    expect(
      strategy.isTrustedIssuer('http://localhost:8080/realms/other', 'http://localhost:8080'),
    ).toBe(false)
  })
})
