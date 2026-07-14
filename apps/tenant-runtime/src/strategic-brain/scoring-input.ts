/**
 * `strategic-brain` scoring input — the ALLOWLIST fairness guard (spec §7, §14 finding M11).
 *
 * [M11] Fairness = ALLOWLIST, not denylist. A denylist ("no field named wiek/plec") only proves a
 * NAME is absent, not that a proxy for a protected characteristic (e.g. home coordinates, etat,
 * anything correlated with age/sex/health/origin) never enters the scorer. The enforceable
 * guarantee is the opposite direction: the scoring input is built ONLY from an explicit set of
 * allowed operational-metric keys, and ANY unexpected key hard-errors the build. This is not a
 * best-effort filter — it is a closed allowlist that fails loudly on anything it doesn't know.
 */

/** The only operational signals the scorer may ever see. No PII, no protected characteristics,
 * no proxies (home location, employment type/etat, etc). Extending this set is a deliberate,
 * reviewable change — not something that happens by a caller passing extra fields. */
const ALLOWED_KEYS = [
  'throughput',
  'completedCount',
  'complaintCount',
  'cycleMinutes',
  'slaHits',
  'peerGroupKey',
  'hiredAt',
] as const

type AllowedKey = (typeof ALLOWED_KEYS)[number]

/** Allowlisted shape of the scoring input. All fields optional — the guard rejects unexpected
 * keys, it does not require a complete set (see `buildScoringInput`). */
export type ScoringInput = Partial<{
  throughput: number
  completedCount: number
  complaintCount: number
  cycleMinutes: number
  slaHits: number
  peerGroupKey: string
  hiredAt: Date
}>

const ALLOWED_KEY_SET: ReadonlySet<string> = new Set(ALLOWED_KEYS)

function isAllowedKey(key: string): key is AllowedKey {
  return ALLOWED_KEY_SET.has(key)
}

/**
 * Builds the scoring input from a raw record, copying ONLY the allowlisted keys. Throws if `raw`
 * contains ANY key outside {@link ALLOWED_KEYS} — proven by iterating every key present, not by
 * checking against a list of known-bad names (M11 proxy-guard). Missing allowlisted keys are
 * fine; this guard rejects the unexpected, it does not require the complete set.
 */
export function buildScoringInput(raw: Record<string, unknown>): ScoringInput {
  const result: ScoringInput = {}
  for (const key of Object.keys(raw)) {
    if (!isAllowedKey(key)) {
      throw new Error(`buildScoringInput: unexpected key "${key}" entered scorer (M11 proxy-guard)`)
    }
    ;(result as Record<string, unknown>)[key] = raw[key]
  }
  return result
}
