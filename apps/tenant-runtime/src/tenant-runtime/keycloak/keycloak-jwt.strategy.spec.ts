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

  const basePayload = (over: Partial<JwtPayload> = {}): JwtPayload => ({
    sub: 'user-uuid-1',
    iss: 'http://localhost:8080/realms/hrobot-acme',
    hrobot_roles: ['ADMIN_KLIENTA'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    // Shape of a real Keycloak token: aud stays "account" unless an audience mapper is set,
    // azp names the client. Verified against a live token from the demo realm.
    aud: 'account',
    azp: 'hrobot-web',
    ...over,
  })

  it('returns the payload unchanged from validate()', () => {
    const payload = basePayload()
    expect(strategy.validate(payload)).toEqual(payload)
  })

  // Q10 — a trusted issuer is not enough; the token must come from an allowlisted client.
  describe('isAllowedClient (audience / azp)', () => {
    const ALLOWED = ['hrobot-web']

    it('accepts the web client via azp, even though aud is Keycloak default "account"', () => {
      expect(strategy.isAllowedClient({ azp: 'hrobot-web', aud: 'account' }, ALLOWED)).toBe(true)
    })

    it('rejects another client in the SAME realm (the actual hole this closes)', () => {
      expect(strategy.isAllowedClient({ azp: 'some-integration', aud: 'account' }, ALLOWED)).toBe(false)
    })

    it('never lets admin-cli through just because it is a configured client elsewhere', () => {
      expect(strategy.isAllowedClient({ azp: 'admin-cli', aud: 'account' }, ALLOWED)).toBe(false)
    })

    it('falls back to aud when azp is absent — string and array forms', () => {
      expect(strategy.isAllowedClient({ aud: 'hrobot-web' }, ALLOWED)).toBe(true)
      expect(strategy.isAllowedClient({ aud: ['account', 'hrobot-web'] }, ALLOWED)).toBe(true)
      expect(strategy.isAllowedClient({ aud: ['account', 'other'] }, ALLOWED)).toBe(false)
    })

    it('prefers azp over aud — a forged aud cannot launder a disallowed client', () => {
      expect(strategy.isAllowedClient({ azp: 'evil', aud: 'hrobot-web' }, ALLOWED)).toBe(false)
    })

    it('rejects a token carrying no client identity at all', () => {
      expect(strategy.isAllowedClient({}, ALLOWED)).toBe(false)
      expect(strategy.isAllowedClient({ azp: '' }, ALLOWED)).toBe(false)
    })

    it('rejects everything when the allowlist is empty (fail closed, not open)', () => {
      expect(strategy.isAllowedClient({ azp: 'hrobot-web' }, [])).toBe(false)
    })

    it('supports several allowlisted clients', () => {
      const multi = ['hrobot-web', 'hrobot-mobile']
      expect(strategy.isAllowedClient({ azp: 'hrobot-mobile' }, multi)).toBe(true)
      expect(strategy.isAllowedClient({ azp: 'hrobot-cli' }, multi)).toBe(false)
    })
  })

  describe('validate() enforces the client allowlist', () => {
    const OLD = process.env.KEYCLOAK_ALLOWED_AZP

    afterEach(() => {
      if (OLD === undefined) delete process.env.KEYCLOAK_ALLOWED_AZP
      else process.env.KEYCLOAK_ALLOWED_AZP = OLD
    })

    it('defaults to the web client when KEYCLOAK_ALLOWED_AZP is unset', () => {
      delete process.env.KEYCLOAK_ALLOWED_AZP
      expect(strategy.validate(basePayload())).toBeDefined()
      expect(() => strategy.validate(basePayload({ azp: 'other' }))).toThrow()
    })

    it('honours a comma-separated KEYCLOAK_ALLOWED_AZP override', () => {
      process.env.KEYCLOAK_ALLOWED_AZP = 'hrobot-web, hrobot-mobile'
      expect(strategy.validate(basePayload({ azp: 'hrobot-mobile' }))).toBeDefined()
      expect(() => strategy.validate(basePayload({ azp: 'hrobot-web-evil' }))).toThrow()
    })

    it('rejects a signed, unexpired token minted for a different client', () => {
      // validate() runs post-verification, so this token is otherwise entirely valid.
      expect(() => strategy.validate(basePayload({ azp: 'rogue-client' }))).toThrow(
        /not issued for this application/i,
      )
    })

    it('rejects a token with no azp and no aud', () => {
      expect(() => strategy.validate(basePayload({ azp: undefined, aud: undefined }))).toThrow(
        /not issued for this application/i,
      )
    })
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
