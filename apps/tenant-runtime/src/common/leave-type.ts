/**
 * ONE tenant-wide classification of `LeaveRequest.type`.
 *
 * WHY THIS FILE EXISTS: `type` is deliberately free text in the schema ("Leave kind
 * (URLOP_WYPOCZYNKOWY, URLOP_NA_ZADANIE, …). Free-form string, not over-modelled."), and two modules
 * used to interpret it with two INCOMPATIBLE rules:
 *
 *  - `strategic-brain/snapshot.service.ts` — `type.toLowerCase().includes('urlop' | 'l4' | 'chorob')`;
 *  - `analityk/analityk.service.ts` — a Prisma `startsWith: 'URLOP'` filter, which on Postgres is
 *    CASE-SENSITIVE (`LIKE 'URLOP%'`) and additionally swept in `URLOP_BEZPŁATNY`,
 *    `URLOP_MACIERZYŃSKI`, `URLOP_RODZICIELSKI` and `URLOP_WYCHOWAWCZY` — none of which draw down the
 *    Kodeks pracy art. 154 annual entitlement.
 *
 * The same row therefore produced two different answers depending on which module read it. This
 * module is now the single source of truth for both, and classification happens IN MEMORY on a
 * normalized key so no SQL collation/case rule can ever re-introduce the divergence.
 */

/**
 * What a leave row means for the modules that read it.
 *
 *  - `WYPOCZYNKOWY` — holiday that DRAWS DOWN the art. 154 annual entitlement (the only category a
 *    leave balance may be reduced by).
 *  - `URLOP_INNY` — a leave that is still an absence but does NOT consume the annual entitlement
 *    (bezpłatny, macierzyński, rodzicielski, wychowawczy, opiekuńczy, okolicznościowy…).
 *  - `L4` — sickness absence.
 *  - `NIEZNANY` — unrecognised. Never guessed into another bucket: an unknown type is UNKNOWN, and
 *    every caller decides its own fail-safe behaviour for it.
 */
export type LeaveCategory = 'WYPOCZYNKOWY' | 'URLOP_INNY' | 'L4' | 'NIEZNANY'

/**
 * The EXPLICIT list of types that consume the art. 154 entitlement, as normalized keys. A closed
 * list on purpose: anything else that merely looks like a holiday (`URLOP_BEZPŁATNY`,
 * `URLOP_MACIERZYŃSKI`, …) must NOT reduce a balance, so the default answer is "does not draw down".
 */
export const URLOP_WYPOCZYNKOWY_TYPES: readonly string[] = ['urlop_wypoczynkowy', 'urlop_na_zadanie']

/** Normalized substrings that mark a sickness absence. Checked BEFORE holiday (an "urlop" never wins
 * over an "l4" in a combined string).
 *
 * `zwolnienie_lekarsk` is deliberately NARROWER than `lekarsk`: an occupational health examination
 * (`BADANIE_LEKARSKIE`) is paid working time under Polish labour law, not a sickness absence, and a
 * wider stem would have quietly removed those hours from the roster. It was added because
 * `ZWOLNIENIE_LEKARSKIE` — the literal the leave form and the voice assistant both write, 14
 * occurrences in production code — matched neither `l4` nor `chorob` and fell through to NIEZNANY.
 * Consequence while it was missing: an employee on sick leave was not excluded from the AI-Grafik
 * scoring window (scored as if present) and landed in the "unknown" bucket in Analityk HR. */
const L4_MARKERS: readonly string[] = ['l4', 'chorob', 'zwolnienie_lekarsk']

/** Normalized substring that marks any kind of leave ("urlop"). */
const URLOP_MARKER = 'urlop'

/**
 * Fold a free-text type to a comparison key: trimmed, lower-cased, and with runs of whitespace or
 * hyphens collapsed to `_`. So `"Urlop wypoczynkowy"`, `"URLOP-WYPOCZYNKOWY"` and
 * `"  urlop_wypoczynkowy "` all classify identically — the very divergence that made the same DB row
 * countable in one module and invisible in the other.
 */
export function normalizeLeaveType(type: string): string {
  return type.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Classify a free-text `LeaveRequest.type`. Total function — every input maps to a category. */
export function classifyLeaveType(type: string): LeaveCategory {
  const key = normalizeLeaveType(type)
  if (L4_MARKERS.some((marker) => key.includes(marker))) return 'L4'
  if (URLOP_WYPOCZYNKOWY_TYPES.includes(key)) return 'WYPOCZYNKOWY'
  if (key.includes(URLOP_MARKER)) return 'URLOP_INNY'
  return 'NIEZNANY'
}

/**
 * `true` only for holiday that reduces the art. 154 annual entitlement. This is the predicate leave
 * BALANCES must be computed with — never a `startsWith('URLOP')` prefix.
 */
export function drawsDownAnnualEntitlement(type: string): boolean {
  return classifyLeaveType(type) === 'WYPOCZYNKOWY'
}

/** `true` for any kind of urlop, entitlement-consuming or not (the coarser question `strategic-brain`
 * asks when deciding whether to exclude a scoring window). */
export function isUrlop(type: string): boolean {
  const category = classifyLeaveType(type)
  return category === 'WYPOCZYNKOWY' || category === 'URLOP_INNY'
}
