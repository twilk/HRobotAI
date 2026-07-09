/**
 * Synthetic PESEL generation + a hard RODO guard (spec §9 mitigation).
 *
 * A PESEL is a real Polish national identifier and thus encrypted PII. This seed must NEVER handle a
 * real one. Two things enforce that here:
 *
 *  1. {@link generateSyntheticPesel} is the ONLY producer of PESELs in the seed. It builds a
 *     valid-*format*, checksum-correct 11-digit number from a synthetic birth date + an index-derived
 *     serial. Every value it returns is stamped with a private {@link SYNTHETIC} brand.
 *  2. {@link assertSyntheticPesel} hard-refuses anything that is not so branded. The runner calls it
 *     immediately before encryption, so a plaintext string sourced from anywhere else — e.g. a real
 *     PESEL pasted into the data — throws instead of being persisted. The brand key is a module-private
 *     Symbol, so external code cannot forge it.
 */

/** Private brand key — not exported, so a `SyntheticPesel` can only originate in this module. */
const SYNTHETIC = Symbol('hrobot.syntheticPesel')

/** A PESEL vouched-for as synthetic. Its raw digits live in `.value`; the brand cannot be forged. */
export interface SyntheticPesel {
  readonly value: string
  readonly [SYNTHETIC]: true
}

const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3] as const

/** PESEL control digit for the first 10 digits (mod-10 weighted checksum). */
function peselChecksum(d: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < 10; i++) sum += d[i]! * PESEL_WEIGHTS[i]!
  return (10 - (sum % 10)) % 10
}

/** True iff `pesel` is 11 digits with a correct PESEL checksum. Format-only; says nothing about realness. */
export function isValidPeselChecksum(pesel: string): boolean {
  if (!/^\d{11}$/.test(pesel)) return false
  const d = [...pesel].map(Number)
  return peselChecksum(d) === d[10]
}

/**
 * Deterministically build a synthetic PESEL for employee `index` with gender `sex`.
 *
 * Birth date is confined to 1970–1999 (so the century month-offset is a no-op and the YYMMDD prefix
 * is literal), and the serial digits encode `index`, giving a unique, checksum-valid number per
 * employee. The value is NOT a real person's identifier — it exists only to exercise the encrypted
 * `pesel` column.
 */
export function generateSyntheticPesel(index: number, sex: 'M' | 'F'): SyntheticPesel {
  if (!Number.isInteger(index) || index < 0 || index > 999) {
    throw new Error(`generateSyntheticPesel: index out of synthetic range: ${index}`)
  }
  const year = 1970 + (index % 30) // 1970..1999 → YY 70..99, no century offset
  const month = (index % 12) + 1 // 1..12
  const day = (index % 28) + 1 // 1..28, always a valid day

  const digits: number[] = [
    Math.floor((year % 100) / 10),
    (year % 100) % 10,
    Math.floor(month / 10),
    month % 10,
    Math.floor(day / 10),
    day % 10,
    Math.floor(index / 100) % 10, // serial hi
    Math.floor(index / 10) % 10, // serial mid
    index % 10, // serial lo
    // sex digit: even → female, odd → male (real PESEL semantics), value varied by index
    ((index % 4) * 2 + (sex === 'M' ? 1 : 0)) % 10,
  ]
  digits.push(peselChecksum(digits))
  const value = digits.join('')

  // Defensive: our own construction must satisfy the checksum we advertise.
  if (!isValidPeselChecksum(value)) {
    throw new Error(`generateSyntheticPesel: produced an invalid checksum for index ${index}`)
  }
  return { value, [SYNTHETIC]: true }
}

/** True iff `x` is a branded {@link SyntheticPesel} produced by {@link generateSyntheticPesel}. */
export function isSyntheticPesel(x: unknown): x is SyntheticPesel {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[SYNTHETIC] === true
}

/**
 * RODO hard-refusal guard. Returns the raw digits ONLY for a branded synthetic PESEL; throws for a
 * bare string or any other unbranded value. The runner must funnel every PESEL through this before
 * encryption, so no externally-sourced (possibly real) PESEL can ever reach the database.
 */
export function assertSyntheticPesel(x: unknown): string {
  if (!isSyntheticPesel(x)) {
    throw new Error(
      'RODO refusal: refusing to persist a PESEL that was not produced by generateSyntheticPesel(). ' +
        'The synthetic seed must never handle real or externally-sourced PESEL data (spec §9).',
    )
  }
  return x.value
}
