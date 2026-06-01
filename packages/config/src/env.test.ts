import { parseEnv } from './env.js'

const valid = {
  CONTROL_PLANE_DATABASE_URL: 'postgresql://u:p@localhost:5432/hrobot_control',
  TENANT_DB_ENCRYPTION_KEY: 'a'.repeat(64),
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_CLIENT_ID: 'hrobot-web',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  NEXTAUTH_SECRET: 'nextauth-secret',
  POSTGRES_SUPERUSER_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
  GLOBAL_ADMIN_JWT_SECRET: 'a'.repeat(32),
}

describe('parseEnv', () => {
  it('parses a fully valid environment', () => {
    const env = parseEnv(valid)
    expect(env.CONTROL_PLANE_DATABASE_URL).toBe(valid.CONTROL_PLANE_DATABASE_URL)
    expect(env.TENANT_DB_ENCRYPTION_KEY).toBe(valid.TENANT_DB_ENCRYPTION_KEY)
  })

  it('throws when a required variable is missing', () => {
    const { NEXTAUTH_SECRET: _omit, ...partial } = valid
    expect(() => parseEnv(partial)).toThrow(/NEXTAUTH_SECRET/)
  })

  it('rejects an encryption key that is not 64 hex chars', () => {
    expect(() => parseEnv({ ...valid, TENANT_DB_ENCRYPTION_KEY: 'tooshort' })).toThrow(
      /TENANT_DB_ENCRYPTION_KEY/,
    )
  })

  it('rejects a non-hex encryption key of correct length', () => {
    expect(() => parseEnv({ ...valid, TENANT_DB_ENCRYPTION_KEY: 'z'.repeat(64) })).toThrow(
      /TENANT_DB_ENCRYPTION_KEY/,
    )
  })

  it('rejects a URL with the wrong scheme (silent prod misconfig)', () => {
    expect(() => parseEnv({ ...valid, REDIS_URL: 'postgres://localhost:5432' })).toThrow(/REDIS_URL/)
    expect(() =>
      parseEnv({ ...valid, CONTROL_PLANE_DATABASE_URL: 'https://localhost:5432/db' }),
    ).toThrow(/CONTROL_PLANE_DATABASE_URL/)
    expect(() => parseEnv({ ...valid, RABBITMQ_URL: 'http://localhost:5672' })).toThrow(/RABBITMQ_URL/)
  })
})
