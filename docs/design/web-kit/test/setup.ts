// Seed env vars for tests that import lib/env.ts
process.env.NEXTAUTH_URL ??= 'http://localhost:3000'
process.env.NEXTAUTH_SECRET ??= 'hrobot-test-secret-minimum-32-characters'
process.env.KEYCLOAK_CLIENT_ID ??= 'hrobot-test'
process.env.KEYCLOAK_CLIENT_SECRET ??= 'hrobot-test-secret'
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/hrobot'

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
