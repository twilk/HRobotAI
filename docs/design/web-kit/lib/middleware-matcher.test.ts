import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ARCHITECTURAL GUARD: every screen in the `(tenant)` route group must be behind the session
 * middleware.
 *
 * WHY THIS EXISTS. `middleware.ts` gates tenant screens with an EXPLICIT matcher list rather than a
 * negative lookahead — a deliberate choice (marketing + API + assets never hit the middleware), but
 * one with a silent failure mode: adding a new screen under `app/(tenant)/` and forgetting the
 * matcher entry leaves that route reachable with NO session, rendering the full AppShell for an
 * anonymous visitor while every sibling route redirects to `/login`. Nothing fails; you only notice
 * by trying it.
 *
 * That is not hypothetical — all THREE M3 modules shipped this way (`/dokumenty`, `/analiza`,
 * `/asystent`), each verified live: the route answered 200 without a cookie where `/dostepy` and
 * `/wnioski` answered 307. This test turns "remember the matcher" into a build gate.
 *
 * The exception list below is deliberately SELF-CLEANING: it must match the still-ungated routes
 * EXACTLY, so closing one without shrinking the list fails this test just as loudly as forgetting a
 * new route. It is a ledger of known debt, never a place to silence the guard.
 */

const webKitRoot = fileURLToPath(new URL('..', import.meta.url))

/** Route segments under `app/(tenant)/` — one directory per tenant screen. */
function tenantRoutes(): string[] {
  return readdirSync(`${webKitRoot}app/(tenant)`, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** The `/segment` prefixes listed in the middleware matcher. */
function matcherRoutes(): string[] {
  const src = readFileSync(`${webKitRoot}middleware.ts`, 'utf8')
  const block = /matcher:\s*\[([\s\S]*?)\]/.exec(src)
  if (!block) throw new Error('middleware.ts: matcher array not found')
  return [...block[1]!.matchAll(/'\/([^/']+)(?:\/:path\*)?'/g)].map((m) => m[1]!).sort()
}

/**
 * Tenant routes KNOWN to be ungated, owned by another autonomy track. Listed so the guard passes on
 * a true statement of today's repo rather than being switched off. Remove an entry the moment its
 * owner adds the matcher line — the "exactly" assertion below will demand it.
 *
 *   analiza  — Analityk HR (TOR C)
 *   asystent — Agent Głosowy (TOR D)
 */
const ZNANE_LUKI = ['analiza', 'asystent'] as const

describe('middleware matcher ↔ app/(tenant) parity', () => {
  it('gates every tenant screen except the documented known gaps', () => {
    const ungated = tenantRoutes().filter((r) => !matcherRoutes().includes(r))
    expect(ungated).toEqual([...ZNANE_LUKI])
  })

  it('[SELF-CLEANING] the known-gap list names only routes that are still ungated', () => {
    // Fails when a track closes its gap but leaves the entry here, so the ledger cannot rot.
    const stillUngated = tenantRoutes().filter((r) => !matcherRoutes().includes(r))
    for (const known of ZNANE_LUKI) {
      expect(stillUngated).toContain(known)
    }
  })

  it('[M3 Dokumenty] /dokumenty is gated and never re-enters the known-gap list', () => {
    expect(matcherRoutes()).toContain('dokumenty')
    expect(ZNANE_LUKI as readonly string[]).not.toContain('dokumenty')
  })

  it('every matcher entry points at a route that actually exists (no stale entries)', () => {
    const routes = tenantRoutes()
    for (const m of matcherRoutes()) {
      expect(routes).toContain(m)
    }
  })

  it('the routes it protects are the real ones, not a hardcoded guess', () => {
    // Sanity: the discovery helpers must be reading real data, else the assertions above are vacuous.
    expect(tenantRoutes()).toContain('dokumenty')
    expect(tenantRoutes().length).toBeGreaterThan(5)
    expect(matcherRoutes()).toContain('dostepy')
  })
})
