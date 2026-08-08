// Server-only tenant identity for the AppShell topbar.
//
// WHY THIS MODULE EXISTS. Sixteen tenant pages each opened with a literal
//   const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
// In a product built database-per-tenant + realm-per-tenant, that literal meant every tenant saw the
// pilot customer's company name in their own topbar. Nothing failed, no test caught it, and the
// screen quietly disagreed with the data underneath it — the API returned the caller's employees
// while the header named somebody else's company.
//
// THE SLUG COMES FROM THE ISSUER ON PURPOSE. tenant-runtime picks the tenant database from the
// Keycloak JWT issuer (`iss` -> realm -> tenant; see lib/tenant-runtime.ts's header). Deriving the
// displayed slug from the same claim is what keeps the header and the data from drifting apart. Any
// other source (env var, host name, cookie) can disagree with the database the request actually hit.
//
// THE NAME COMES FROM ustawienia. `GET /ustawienia/company` already owns `companyName` — the tenant
// admin edits it in Ustawienia. Reading it here means the topbar follows a rename with no code
// change. When that call fails we degrade to the slug, never to another tenant's name.

import { cache } from 'react'
import { getSession } from './session'
import { tenantRuntimeBaseUrl } from './tenant-runtime'

export interface Tenant {
  /** Display name — `companyName` from ustawienia, else the slug, else {@link FALLBACK_TENANT_NAME}. */
  name: string
  /** Realm-derived tenant slug, or '' when there is no decodable session. */
  slug: string
}

/** Shown only when there is neither a company name nor a decodable issuer. Deliberately neutral. */
export const FALLBACK_TENANT_NAME = 'Twoja organizacja'

/**
 * Extract the tenant slug from a Keycloak issuer URL.
 *
 * Realms are named `hrobot-<slug>` for hand-seeded environments and `hrobot_t_<id>` for provisioned
 * ones (the provisioning step builds the latter). Only the dash form carries a strippable prefix, so
 * the underscore form is returned whole — stripping it would produce a slug that matches no realm.
 */
export function slugFromIssuer(iss: string | undefined | null): string | null {
  if (!iss) return null
  const m = /\/realms\/([^/?#]+)/.exec(iss)
  const realm = m?.[1]
  if (!realm) return null
  // `slice` rather than a global replace: a realm named `hrobot-hrobot-x` must yield `hrobot-x`.
  return realm.startsWith('hrobot-') ? realm.slice('hrobot-'.length) : realm
}

/** Pick what the topbar shows. Blank/whitespace company names must not win over the slug. */
export function tenantDisplayName(companyName: string | undefined | null, slug: string | null): string {
  const trimmed = companyName?.trim()
  if (trimmed) return trimmed
  if (slug) return slug
  return FALLBACK_TENANT_NAME
}

/** The `iss` claim, read from the same base64url payload lib/session.ts decodes. */
function issuerFromToken(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>
    return typeof claims.iss === 'string' ? claims.iss : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the current tenant for a server component.
 *
 * Wrapped in React `cache()` so the sixteen pages that call it once each still make at most ONE
 * settings request per render pass. Never throws: a page must render its shell even when the
 * settings call is down, so every failure path degrades to the slug.
 */
export const getTenant = cache(async (): Promise<Tenant> => {
  const session = await getSession()
  if (!session) return { name: FALLBACK_TENANT_NAME, slug: '' }

  const slug = slugFromIssuer(issuerFromToken(session.token))

  let companyName: string | undefined
  try {
    const res = await fetch(`${tenantRuntimeBaseUrl()}/ustawienia/company`, {
      headers: { authorization: `Bearer ${session.token}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const body = (await res.json()) as { companyName?: unknown }
      if (typeof body.companyName === 'string') companyName = body.companyName
    }
  } catch {
    // Settings unreachable — fall through to the slug. The shell still renders.
  }

  return { name: tenantDisplayName(companyName, slug), slug: slug ?? '' }
})
