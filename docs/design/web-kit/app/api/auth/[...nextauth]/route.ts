/**
 * Auth.js v5 catch-all route.
 * Handles: GET/POST for /api/auth/signin, /api/auth/callback/keycloak,
 * /api/auth/signout, /api/auth/session, /api/auth/csrf, etc.
 */
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
