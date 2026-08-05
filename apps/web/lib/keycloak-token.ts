// Server-only Keycloak token provider. Mints a tenant-runtime bearer via the OAuth2 Resource Owner
// Password Credentials ("direct grant") flow, caches it in module scope, and refreshes it before it
// expires — so the web-kit proxy can self-authenticate against the live backend without a login flow
// and without ever shipping a static token (Keycloak access tokens expire in ~300s).
//
// SECURITY / RODO: every credential + URL comes from ENV — nothing is hardcoded in the repo. When any
// of the four vars is unset the provider is a no-op (returns null), so a shared/hosted deploy without
// creds falls through to the proxy's other auth sources rather than leaking a baked-in secret. The
// password and the minted token are NEVER logged.
//
//   KEYCLOAK_TOKEN_URL   — full token endpoint, e.g.
//                          http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token
//   KEYCLOAK_CLIENT_ID   — public client id, e.g. hrobot-web
//   KEYCLOAK_USERNAME    — demo/service user
//   KEYCLOAK_PASSWORD    — that user's password
//
// This module MUST stay server-only — importing it into a client bundle would leak the creds.

/** Refresh a cached token once fewer than this many ms remain before its expiry. */
const REFRESH_SKEW_MS = 60_000

interface KeycloakConfig {
  tokenUrl: string
  clientId: string
  username: string
  password: string
}

interface CachedToken {
  /** The raw access_token string (no `Bearer ` prefix). */
  accessToken: string
  /** Epoch ms at which this token should be considered stale (real expiry minus the skew). */
  refreshAt: number
}

// Module-scoped cache + in-flight de-dup. A single Next.js server process shares these across all
// requests, so concurrent proxy calls reuse one mint rather than stampeding Keycloak.
let cached: CachedToken | null = null
let inFlight: Promise<CachedToken | null> | null = null

/** Read the four env vars; returns null (provider disabled) unless ALL are present + non-empty. */
function readConfig(): KeycloakConfig | null {
  const tokenUrl = process.env.KEYCLOAK_TOKEN_URL
  const clientId = process.env.KEYCLOAK_CLIENT_ID
  const username = process.env.KEYCLOAK_USERNAME
  const password = process.env.KEYCLOAK_PASSWORD
  if (!tokenUrl || !clientId || !username || !password) return null
  return { tokenUrl, clientId, username, password }
}

/** Current monotonic-enough clock. Wrapped so tests can stub it via Date. */
function now(): number {
  return Date.now()
}

/** Perform the direct-grant POST and return a freshly-minted cache entry (never logs secrets). */
async function mint(config: KeycloakConfig): Promise<CachedToken | null> {
  const form = new URLSearchParams({
    grant_type: 'password',
    client_id: config.clientId,
    username: config.username,
    password: config.password,
  })

  let res: Response
  try {
    res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      cache: 'no-store',
    })
  } catch (err) {
    // Network failure reaching Keycloak — surface a scrubbed message, never the request body.
    console.error(`[keycloak-token] could not reach Keycloak token endpoint: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  if (!res.ok) {
    // Log the status only — the body can echo back grant details, so we do not log it.
    console.error(`[keycloak-token] token endpoint returned ${res.status}`)
    return null
  }

  let payload: { access_token?: string; expires_in?: number }
  try {
    payload = (await res.json()) as { access_token?: string; expires_in?: number }
  } catch {
    console.error('[keycloak-token] token endpoint returned a non-JSON body')
    return null
  }

  if (!payload.access_token) {
    console.error('[keycloak-token] token response had no access_token')
    return null
  }

  // expires_in is seconds; default to 300s (Keycloak's usual access-token lifetime) if absent, then
  // subtract the skew so we refresh before the backend would reject an about-to-expire token.
  const ttlMs = (payload.expires_in ?? 300) * 1000
  const refreshAt = now() + Math.max(0, ttlMs - REFRESH_SKEW_MS)
  return { accessToken: payload.access_token, refreshAt }
}

/**
 * Return a valid Keycloak access token (no `Bearer ` prefix), minting or refreshing as needed, or
 * null when the provider is disabled (creds unset) or Keycloak is unreachable/errors.
 *
 * @param forceRefresh  bypass the cache and mint anew — used when the backend 401s a cached token
 *                      that expired between our skew check and its arrival at tenant-runtime.
 */
export async function getKeycloakToken(forceRefresh = false): Promise<string | null> {
  const config = readConfig()
  if (!config) return null

  if (!forceRefresh && cached && now() < cached.refreshAt) {
    return cached.accessToken
  }

  // De-dup concurrent mints: the first caller kicks off the request, the rest await the same promise.
  if (!inFlight) {
    inFlight = mint(config).then((token) => {
      if (token) cached = token
      return token
    }).finally(() => {
      inFlight = null
    })
  }

  const token = await inFlight
  return token ? token.accessToken : null
}

/** Test-only: drop the module-scoped cache + any in-flight mint so each test starts clean. */
export function __resetKeycloakTokenCacheForTests(): void {
  cached = null
  inFlight = null
}
