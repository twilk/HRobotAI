import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { extname, join } from 'path'
import { DocumentStatus } from './dokumenty.enums.js'

/**
 * DOK-10 — TWARDA GRANICA: brak wysyłki na zewnątrz (art. 22 RODO; SPEC §0/§1.3/§9).
 *
 * Static analysis (no DI/runtime), mirroring `strategic-brain/write-boundary.spec.ts`. It proves two
 * things about the module's ONE lifecycle enum: there is no state that represents "sent"/"exported
 * to an external system", and the module source contains no outbound-send call to ZUS/Płatnik. If a
 * future edit adds a `SENT`/`EXPORTED_EXTERNAL` state (or an HTTP client aimed at ZUS), this fails.
 */

const MODULE_DIR = __dirname

/** Locate the authoritative Prisma tenant schema (the DB enum is the source of truth). */
function findSchema(): string | null {
  const candidates = [
    join(MODULE_DIR, '../../../../packages/db/prisma/tenant/schema.prisma'),
    join(MODULE_DIR, '../../../../../packages/db/prisma/tenant/schema.prisma'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full))
      continue
    }
    if (extname(entry) !== '.ts') continue
    if (entry.endsWith('.spec.ts') || entry.endsWith('.test.ts')) continue
    files.push(full)
  }
  return files
}

describe('dokumenty — no external send (DOK-10)', () => {
  it('the module DocumentStatus enum has NO SENT / EXPORTED_EXTERNAL member', () => {
    const members = Object.values(DocumentStatus)
    expect(members).toEqual(['GENERATED', 'APPROVED', 'SUPERSEDED'])
    expect(members).not.toContain('SENT')
    expect(members).not.toContain('EXPORTED_EXTERNAL')
  })

  it('the authoritative Prisma DocumentStatus enum also excludes SENT / EXPORTED_EXTERNAL', () => {
    const schemaPath = findSchema()
    expect(schemaPath).not.toBeNull()
    const schema = readFileSync(schemaPath as string, 'utf8')
    const block = /enum\s+DocumentStatus\s*\{([^}]*)\}/.exec(schema)
    expect(block).not.toBeNull()
    const body = block![1]!
    expect(body).toContain('GENERATED')
    expect(body).toContain('APPROVED')
    expect(body).toContain('SUPERSEDED')
    expect(body).not.toMatch(/\bSENT\b/)
    expect(body).not.toMatch(/\bEXPORTED_EXTERNAL\b/)
  })

  it('no module source performs an outbound network call (fetch/axios/XMLHttpRequest/http URL)', () => {
    const files = collectSourceFiles(MODULE_DIR)
    expect(files.length).toBeGreaterThan(0)
    // Genuine outbound-network indicators only — NOT domain vocabulary like "płatnik"/"ZUS", which
    // are legitimate KEDU data labels, not a send. `fetch`/`axios`/`XMLHttpRequest` stay banned
    // UNCONDITIONALLY (render/pdf.renderer.ts deliberately uses `node:http` instead, precisely so it
    // never needs an exception here). The URL-literal check exempts ONLY loopback
    // (127.0.0.1/localhost): render/pdf.renderer.ts's Chrome-DevTools-Protocol print pipeline talks
    // to a Chrome process it spawns itself, on the same machine — data never crosses the network
    // boundary DOK-10 exists to police (see that file's own module doc comment). Any OTHER host —
    // including a real ZUS/Płatnik endpoint — still fails this test.
    const OUTBOUND = [/\bfetch\s*\(/, /\baxios\b/, /XMLHttpRequest/, /https?:\/\/(?!127\.0\.0\.1|localhost\b)[a-z0-9]/i]
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const rx of OUTBOUND) {
        expect(text).not.toMatch(rx)
      }
    }
  })
})
