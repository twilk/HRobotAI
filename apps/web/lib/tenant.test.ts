import { describe, expect, it } from 'vitest'
import { FALLBACK_TENANT_NAME, slugFromIssuer, tenantDisplayName } from './tenant'

/**
 * Guard for the tenant identity shown in the AppShell topbar.
 *
 * WHY THIS EXISTS. Sixteen tenant pages each carried a literal
 * `const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }`. In a product whose
 * whole architecture is database-per-tenant + realm-per-tenant, that literal meant EVERY tenant saw
 * the first customer's company name in their own topbar — a cross-tenant identity leak in the UI
 * layer, and an unusable demo for any second prospect.
 *
 * The slug is derived from the Keycloak issuer because that is the same value tenant-runtime uses to
 * pick the database (`iss` -> realm -> tenant). Deriving it anywhere else would let the screen and
 * the data disagree, which is the failure mode the literal already had.
 */

describe('slugFromIssuer', () => {
  it('reads the realm out of a Keycloak issuer URL', () => {
    expect(slugFromIssuer('http://keycloak:8080/realms/hrobot-4mobility')).toBe('4mobility')
  })

  it('strips only the hrobot- prefix, never a substring inside the name', () => {
    // A realm literally named `hrobot-hrobot-x` must yield `hrobot-x`, not `x`.
    expect(slugFromIssuer('https://auth.example.com/realms/hrobot-hrobot-x')).toBe('hrobot-x')
  })

  it('keeps a realm that does not carry the prefix', () => {
    // Provisioned realms use hrobot_t_<id> (see the live tenant naming), which has no `hrobot-`.
    expect(slugFromIssuer('http://kc:8080/realms/hrobot_t_900d948b')).toBe('hrobot_t_900d948b')
  })

  it('tolerates a trailing slash and extra path segments', () => {
    expect(slugFromIssuer('http://kc:8080/realms/hrobot-acme/')).toBe('acme')
    expect(slugFromIssuer('http://kc:8080/realms/hrobot-acme/protocol/openid-connect')).toBe('acme')
  })

  it('returns null for anything that is not a realm issuer', () => {
    expect(slugFromIssuer(undefined)).toBeNull()
    expect(slugFromIssuer('')).toBeNull()
    expect(slugFromIssuer('http://kc:8080/auth')).toBeNull()
    expect(slugFromIssuer('not a url at all')).toBeNull()
    expect(slugFromIssuer('http://kc:8080/realms/')).toBeNull()
  })
})

describe('tenantDisplayName', () => {
  it('prefers the company name configured in ustawienia', () => {
    expect(tenantDisplayName('Acme sp. z o.o.', 'acme')).toBe('Acme sp. z o.o.')
  })

  it('falls back to the slug when the company name is unset', () => {
    // A blank name must NOT fall through to some other tenant's name.
    expect(tenantDisplayName('', 'acme')).toBe('acme')
    expect(tenantDisplayName(undefined, 'acme')).toBe('acme')
    expect(tenantDisplayName('   ', 'acme')).toBe('acme')
  })

  it('falls back to a neutral label when there is no slug either', () => {
    expect(tenantDisplayName(undefined, null)).toBe(FALLBACK_TENANT_NAME)
  })

  it('NEVER falls back to a hardcoded customer name', () => {
    // The regression this whole module exists to prevent.
    for (const out of [tenantDisplayName(undefined, null), tenantDisplayName('', 'x'), FALLBACK_TENANT_NAME]) {
      expect(out).not.toMatch(/4Mobility/i)
    }
  })
})

describe('[ARCHITECTURAL GUARD] no page hardcodes a customer identity', () => {
  it('no file under app/ or components/ contains a literal tenant name or slug', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const root = fileURLToPath(new URL('..', import.meta.url))

    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next') continue
        const full = `${dir}/${entry}`
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
        const src = readFileSync(full, 'utf8')
        // The demo seed data legitimately names the pilot customer; screens must not.
        if (/4Mobility sp\. z o\.o\.|4mobility\.hrobot\.ai/.test(src)) {
          offenders.push(full.slice(root.length))
        }
      }
    }
    walk(`${root}app`)
    walk(`${root}components`)

    expect(offenders).toEqual([])
  })
})
