// Server-only: exchange a Keycloak refresh token for a fresh access token (refresh_token grant).
// Mirrors the direct-grant config used by lib/auth-actions.ts.
const DEFAULT_TOKEN_URL = 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token'
const DEFAULT_CLIENT_ID = 'hrobot-web'

export interface RefreshedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshedTokens | null> {
  const tokenUrl = process.env.KEYCLOAK_TOKEN_URL || DEFAULT_TOKEN_URL
  const clientId = process.env.KEYCLOAK_CLIENT_ID || DEFAULT_CLIENT_ID
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken })

  let res: Response
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const j = (await res.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number }
    | null
  if (!j?.access_token) return null
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? refreshToken,
    expiresIn: j.expires_in ?? 300,
    refreshExpiresIn: j.refresh_expires_in ?? 1800,
  }
}
