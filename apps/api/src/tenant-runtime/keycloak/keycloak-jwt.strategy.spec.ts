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
})
