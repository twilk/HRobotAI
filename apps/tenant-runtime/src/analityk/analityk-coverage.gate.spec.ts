import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * CI GATE: no Analityk HR aggregate ships with mocked-Prisma coverage only.
 *
 * WHY. Four HR metrics were wrong in production while 875 unit tests were green, and they stayed
 * undetectable because `analityk.service.spec.ts` drives a mocked Prisma client that IGNORES the
 * `where` clause and returns the same rows for every query. Its own comment admits it: "the mock
 * returns the same rows for both windows, so every delta is 0". Any aggregate that filters by time
 * window — which is all of them — is therefore untestable in that lane by construction.
 *
 * The real-Postgres lane (`analityk.integration.spec.ts`) exists and is good. What was missing was
 * anything forcing the NEXT aggregate into it. This gate is that rule: it reads both files and fails
 * when a public aggregate on the service is never exercised against a real database.
 *
 * It lives in the UNIT lane on purpose. It parses source text and touches no database, so it runs on
 * every PR — including the ones that add an aggregate without bringing Postgres up locally. Putting
 * it in the integration lane would mean the gate only fires where the coverage already exists.
 *
 * FIXING A FAILURE: add a case to `analityk.integration.spec.ts` that calls the method over two
 * disjoint windows and asserts DIRECTIONALLY (a delta with a sign), not just that a number came
 * back. Widening EXEMPT is a last resort and needs the reason written down.
 */

const HERE = __dirname
const SERVICE = readFileSync(path.join(HERE, 'analityk.service.ts'), 'utf8')
const INTEGRATION = readFileSync(path.join(HERE, 'analityk.integration.spec.ts'), 'utf8')

/** Public async methods on AnalitykService — the aggregate surface the controller can call. */
function aggregateMethods(): string[] {
  return [...SERVICE.matchAll(/^ {2}async ([a-zA-Z]+)\(/gm)]
    .map((m) => m[1]!)
    .filter((name) => !NOT_AN_AGGREGATE.has(name))
    .sort()
}

/** Methods that read no time-windowed rows, so a real database proves nothing extra about them. */
const NOT_AN_AGGREGATE = new Set([
  // Resolves the caller's unit scope from their roles. No aggregation, no window, no `where` on a
  // date — the mocked lane tests it perfectly well.
  'resolveScope',
])

/**
 * Aggregates knowingly not exercised against a real database, each with the reason.
 * SELF-CLEANING: an entry that IS covered fails the second test, so this cannot rot into a list of
 * things somebody once meant to get to.
 */
const EXEMPT: Record<string, string> = {
  // `podsumowanie` is pure composition — it awaits zatrudnienie/absencje/czasPracy/urlopy/wnioski and
  // returns them under one object, adding no filtering of its own. Every component IS covered
  // against real rows, so a real-DB case here would re-test five covered things and assert nothing
  // new. If it ever computes a figure itself, delete this entry.
  podsumowanie: 'pure composition of five aggregates that are each covered individually',
}

/** Which aggregates the real-Postgres spec actually calls. */
function coveredByIntegration(): Set<string> {
  return new Set([...INTEGRATION.matchAll(/\bservice\.([a-zA-Z]+)\(/g)].map((m) => m[1]!))
}

describe('[CI GATE] every Analityk aggregate is exercised against a real Postgres', () => {
  it('finds the aggregates and the integration calls (not vacuous)', () => {
    // Without this, a broken regex would make the gate below pass over two empty sets.
    expect(aggregateMethods().length).toBeGreaterThanOrEqual(8)
    expect(coveredByIntegration().size).toBeGreaterThanOrEqual(6)
  })

  it('no aggregate is covered by mocked Prisma alone', () => {
    const covered = coveredByIntegration()
    const uncovered = aggregateMethods().filter((m) => !covered.has(m) && !(m in EXEMPT))

    expect(uncovered).toEqual([])
  })

  it('[SELF-CLEANING] no exemption names an aggregate that is in fact covered', () => {
    const covered = coveredByIntegration()
    const stale = Object.keys(EXEMPT).filter((m) => covered.has(m))

    expect(stale).toEqual([])
  })

  it('[SELF-CLEANING] no exemption names a method that no longer exists', () => {
    const methods = new Set(aggregateMethods())
    const orphaned = Object.keys(EXEMPT).filter((m) => !methods.has(m))

    expect(orphaned).toEqual([])
  })

  it('every exemption carries a reason, not a placeholder', () => {
    // A one-word reason is worse than none — it looks like a decision was made.
    const tooShort = Object.entries(EXEMPT)
      .filter(([, reason]) => reason.length <= 30)
      .map(([method]) => method)

    expect(tooShort).toEqual([])
  })

  it('the integration spec still refuses to skip silently in CI', () => {
    // The whole gate is worthless if the lane it points at self-skips on a missing env var and CI
    // reads that as green. analityk.integration.spec.ts hard-fails there instead; pin that.
    expect(INTEGRATION).toMatch(/if \(!SUPERUSER_URL && process\.env\.CI\)/)
    expect(INTEGRATION).toMatch(/describe\.skip/)
  })
})
