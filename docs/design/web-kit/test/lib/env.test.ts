import { describe, it, expect } from 'vitest'
import { envSchema } from '@/lib/env'

const VALID = {
  NEXTAUTH_URL: 'http://localhost:3000',
  NEXTAUTH_SECRET: 'hrobot-test-secret-minimum-32-characters',
  KEYCLOAK_CLIENT_ID: 'hrobot',
  KEYCLOAK_CLIENT_SECRET: 'secret',
  KEYCLOAK_ISSUER: 'http://localhost:8080/realms/hrobot',
}

describe('envSchema', () => {
  it('accepts valid env', () => {
    expect(envSchema.safeParse(VALID).success).toBe(true)
  })
  it('rejects NEXTAUTH_SECRET shorter than 32 chars', () => {
    expect(envSchema.safeParse({ ...VALID, NEXTAUTH_SECRET: 'short' }).success).toBe(false)
  })
  it('rejects non-URL NEXTAUTH_URL', () => {
    expect(envSchema.safeParse({ ...VALID, NEXTAUTH_URL: 'not-a-url' }).success).toBe(false)
  })
  it('rejects non-URL KEYCLOAK_ISSUER', () => {
    expect(envSchema.safeParse({ ...VALID, KEYCLOAK_ISSUER: 'not-a-url' }).success).toBe(false)
  })
  it('allows missing NEXT_PUBLIC_APP_URL (optional)', () => {
    const without = { ...VALID }
    delete (without as Record<string, unknown>).NEXT_PUBLIC_APP_URL
    expect(envSchema.safeParse(without).success).toBe(true)
  })
})
