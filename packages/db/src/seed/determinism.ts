import { createHash } from 'node:crypto'

/**
 * Determinism primitives for the canonical synthetic seed. The seed is a FROZEN, shared dataset
 * (Tor C cold-start + Tor E UAT both import it), so every id and every "random" choice MUST be a
 * pure function of a stable natural key — never `uuid()` defaults or `Math.random()`. These two
 * helpers are the only sources of "identity" and "variety" in the seed:
 *
 *  - {@link stableId} — a name-based UUIDv5 from a fixed namespace, so the same natural key always
 *    yields the same UUID across runs and machines (the idempotent-upsert key).
 *  - {@link mulberry32} — a tiny seeded PRNG for the few places that need spread (which of N names,
 *    which etat bucket) without threading an index everywhere.
 */

/** Fixed namespace for all seed UUIDv5 ids. Changing this re-keys the ENTIRE dataset, so don't. */
export const SEED_NAMESPACE = '5eed0000-4d32-5a11-9c0a-11ab0b070000'

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(`stableId: invalid namespace UUID ${uuid}`)
  }
  return Buffer.from(hex, 'hex')
}

function bytesToUuid(bytes: Buffer): string {
  const h = bytes.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/**
 * Deterministic RFC-4122 v5 (SHA-1, name-based) UUID from {@link SEED_NAMESPACE} + a natural key.
 * `stableId('employee', 'PESEL-…')` is the same UUID on every run — this is the primary key the
 * seed upserts on, which is what makes re-running a no-op instead of a duplicate insert.
 */
export function stableId(...parts: Array<string | number>): string {
  const name = parts.join(':')
  const hash = createHash('sha1').update(uuidToBytes(SEED_NAMESPACE)).update(name, 'utf8').digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC-4122 variant
  return bytesToUuid(bytes)
}

/** Seeded 32-bit PRNG (mulberry32). Deterministic: same seed → same sequence of [0,1) floats. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick a deterministic element of `arr` from a 0-based index (wraps). */
export function pick<T>(arr: readonly T[], index: number): T {
  return arr[((index % arr.length) + arr.length) % arr.length]!
}
