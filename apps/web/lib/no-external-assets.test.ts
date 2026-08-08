import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * ARCHITECTURAL GUARD: the browser must not fetch assets from a third-party host.
 *
 * WHY THIS EXISTS. `app/layout.tsx` shipped three runtime stylesheet links — two to
 * api.fontshare.com, one to fonts.googleapis.com (plus a gstatic preconnect). Every employee opening
 * any screen therefore announced their IP address to Fontshare and to Google. This product's first
 * selling point is RODO compliance and it holds Polish employees' personal data; Google Fonts has
 * specific EU case law against it (LG München I, 3 O 17493/20). The self-hosted replacement already
 * existed in `app/fonts.ts` and was simply never wired up, so the leak was one import away from
 * being fixed for months.
 *
 * A regression here is invisible: adding a `<link rel="stylesheet" href="https://…">` renders fine,
 * breaks no test, and reintroduces the exact finding. Hence a guard rather than a comment.
 *
 * SCOPE. Only asset references the BROWSER resolves — stylesheets, scripts, fonts, images, iframes,
 * preconnect/dns-prefetch hints. Server-side `fetch()` to a backend is a different thing entirely
 * and is not matched: it never exposes the visitor's IP to anyone.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Attributes whose value the browser turns into a network request for a subresource. */
const ASSET_ATTR = /\b(?:href|src)\s*=\s*(?:"|'|\{')(https?:)?\/\/([^"'`/\s]+)/gi

/** Hosts allowed to appear in a browser-resolved asset URL. Empty on purpose: self-host instead. */
const ALLOWED_HOSTS = new Set<string>([])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = `${dir}/${entry}`
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc)
      continue
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

describe('[ARCHITECTURAL GUARD] no third-party asset hosts', () => {
  it('no component or page references a browser-loaded asset on an external host', () => {
    const offenders: string[] = []

    for (const file of [...sourceFiles(`${ROOT}app`), ...sourceFiles(`${ROOT}components`)]) {
      const src = readFileSync(file, 'utf8')
      for (const match of src.matchAll(ASSET_ATTR)) {
        const host = match[2]!
        if (!ALLOWED_HOSTS.has(host)) offenders.push(`${file.slice(ROOT.length)} -> ${host}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('the root layout carries no preconnect / dns-prefetch to a third party', () => {
    const layout = readFileSync(`${ROOT}app/layout.tsx`, 'utf8')
    expect(layout).not.toMatch(/rel=["'](?:preconnect|dns-prefetch)["']/)
  })

  it('the root layout renders the self-hosted next/font variables', () => {
    // Positive control: if layout.tsx stopped importing fonts.ts the guard above would still pass
    // while every face silently fell back to system-ui.
    const layout = readFileSync(`${ROOT}app/layout.tsx`, 'utf8')
    expect(layout).toMatch(/from '\.\/fonts'/)
    expect(layout).toMatch(/className=\{fontVars\}/)
  })

  it('[NOT VACUOUS] the matcher does detect an external asset link', () => {
    const sample = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X" />`
    const hosts = [...sample.matchAll(ASSET_ATTR)].map((m) => m[2])
    expect(hosts).toEqual(['fonts.googleapis.com'])
  })
})
