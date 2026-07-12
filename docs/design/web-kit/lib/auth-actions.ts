'use server'

// Real login/logout for web-kit. `login` performs a Keycloak Resource-Owner-Password ("direct grant")
// against the `hrobot-web` public client SERVER-SIDE and, on success, sets the httpOnly `hrobot_token`
// cookie with the access token. The tenant-runtime proxy (lib/tenant-runtime.ts) already reads that
// cookie BEFORE self-minting, so the whole app then acts as the logged-in user. `logout` clears it.
//
// SECURITY: the password only ever exists in this server action's request scope — it is posted to
// Keycloak and never persisted, logged, or returned. The token cookie is httpOnly so client JS can't
// read it. We reuse the KEYCLOAK_* env (same as the self-mint provider) and fall back to the local
// staging endpoint/client for the demo.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE } from './session'

const DEFAULT_TOKEN_URL = 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token'
const DEFAULT_CLIENT_ID = 'hrobot-web'

export interface LoginState {
  error?: string
}

/**
 * Server action (useActionState signature). Reads `login` + `pw` from the form, direct-grants against
 * Keycloak, sets the session cookie, and redirects to /dashboard. Returns `{ error }` for the form to
 * render on any failure.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get('login') ?? '').trim()
  const password = String(formData.get('pw') ?? '')
  if (!username || !password) {
    return { error: 'Podaj login i hasło.' }
  }

  const tokenUrl = process.env.KEYCLOAK_TOKEN_URL || DEFAULT_TOKEN_URL
  const clientId = process.env.KEYCLOAK_CLIENT_ID || DEFAULT_CLIENT_ID

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    username,
    password,
  })

  let res: Response
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    })
  } catch {
    return { error: 'Nie można połączyć się z serwerem uwierzytelniania.' }
  }

  if (res.status === 401 || res.status === 400) {
    // Keycloak returns 401 for a bad client/realm and 400 (invalid_grant) for wrong credentials.
    return { error: 'Nieprawidłowy login lub hasło.' }
  }
  if (!res.ok) {
    return { error: `Błąd uwierzytelniania (${res.status}).` }
  }

  let payload: { access_token?: string; expires_in?: number }
  try {
    payload = (await res.json()) as { access_token?: string; expires_in?: number }
  } catch {
    return { error: 'Nieprawidłowa odpowiedź serwera uwierzytelniania.' }
  }
  if (!payload.access_token) {
    return { error: 'Serwer nie zwrócił tokenu dostępu.' }
  }

  const store = await cookies()
  store.set(SESSION_COOKIE, payload.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Cookie lives exactly as long as the access token: once it expires the proxy would get a 401,
    // so we let the cookie lapse and re-gate to /login rather than forward a dead token.
    maxAge: payload.expires_in ?? 300,
  })

  // redirect() throws NEXT_REDIRECT — must stay outside any try/catch so it isn't swallowed.
  redirect('/dashboard')
}

/** Clear the session cookie and return to /login. */
export async function logout(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  redirect('/login')
}
