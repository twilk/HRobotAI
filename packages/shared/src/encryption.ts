import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // bytes — NIST SP 800-38D recommended 96-bit GCM nonce
const AUTH_TAG_LENGTH = 16 // bytes — GCM tag
const KEY_LENGTH = 32 // bytes — AES-256
const MIN_PAYLOAD = 1 + IV_LENGTH + AUTH_TAG_LENGTH // version + iv + tag (+ >=0 ciphertext)

/** Thrown by {@link EncryptionService.decrypt} for any decryption failure. Lets callers
 * distinguish "tampered/corrupt/wrong-key" (a security or config event worth alerting on)
 * from an ordinary bug, instead of leaking Node's opaque low-level crypto errors. */
export class DecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DecryptionError'
  }
}

/** A versioned set of 32-byte keys. The version byte stored in each ciphertext selects
 * the key on decrypt, so a key can be rotated by adding a new version and flipping
 * `activeVersion` — old ciphertext keeps decrypting under its original key. */
export interface EncryptionKeyring {
  /** version (1..255) → 32-byte key */
  keys: Record<number, Buffer>
  /** version used to encrypt new values */
  activeVersion: number
}

/**
 * Application-layer authenticated encryption for sensitive PII (employees.pesel)
 * and secrets at rest (tenants.db_url). AES-256-GCM: confidentiality + integrity.
 *
 * Stored format (base64): [version (1B)][IV (12B)][authTag (16B)][ciphertext].
 * - The version byte selects the key from the keyring on decrypt, so keys can be rotated
 *   without a flag-day re-encrypt: add a new key version and flip `activeVersion`; old
 *   ciphertext still decrypts under its original version.
 * - A fresh random 96-bit IV per call means identical plaintexts yield distinct ciphertexts.
 * - Optional AAD binds a ciphertext to its context (e.g. `tenant:<id>:pesel`) so a blob
 *   cannot be cut-and-pasted to another row/column and still authenticate.
 */
export class EncryptionService {
  private readonly keys: Map<number, Buffer>
  private readonly activeVersion: number

  /** Pass a single 32-byte Buffer (becomes key version 1) or a versioned keyring. */
  constructor(keyOrKeyring: Buffer | EncryptionKeyring) {
    if (Buffer.isBuffer(keyOrKeyring)) {
      assertKey(keyOrKeyring)
      this.keys = new Map([[1, keyOrKeyring]])
      this.activeVersion = 1
      return
    }
    const entries = Object.entries(keyOrKeyring.keys).map(([v, k]) => [Number(v), k] as const)
    if (entries.length === 0) {
      throw new Error('EncryptionService keyring must contain at least one key')
    }
    for (const [version, key] of entries) {
      if (!Number.isInteger(version) || version < 1 || version > 255) {
        throw new Error(`EncryptionService key version must be an integer 1..255, got ${version}`)
      }
      assertKey(key)
    }
    if (!keyOrKeyring.keys[keyOrKeyring.activeVersion]) {
      throw new Error(`EncryptionService activeVersion ${keyOrKeyring.activeVersion} has no key in the keyring`)
    }
    this.keys = new Map(entries)
    this.activeVersion = keyOrKeyring.activeVersion
  }

  /** Build from a hex-encoded 32-byte key (64 hex chars), e.g. env.TENANT_DB_ENCRYPTION_KEY. */
  static fromHexKey(hexKey: string): EncryptionService {
    if (typeof hexKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error('EncryptionService.fromHexKey expects exactly 64 hex chars (32 bytes)')
    }
    return new EncryptionService(Buffer.from(hexKey, 'hex'))
  }

  encrypt(plaintext: string, aad?: string): string {
    const key = this.keys.get(this.activeVersion)
    if (!key) throw new Error(`EncryptionService active key version ${this.activeVersion} missing`)
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([Buffer.from([this.activeVersion]), iv, authTag, ciphertext]).toString('base64')
  }

  decrypt(payload: string, aad?: string): string {
    if (typeof payload !== 'string' || payload.length === 0) {
      throw new DecryptionError('decrypt: payload must be a non-empty base64 string')
    }
    const data = Buffer.from(payload, 'base64')
    if (data.length < MIN_PAYLOAD) {
      throw new DecryptionError(
        `decrypt: payload too short (${data.length}B < ${MIN_PAYLOAD}B) — corrupt or not produced by EncryptionService`,
      )
    }
    const version = data[0]!
    const key = this.keys.get(version)
    if (!key) {
      throw new DecryptionError(`decrypt: unknown key version ${version} — wrong keyring or corrupt payload`)
    }
    const iv = data.subarray(1, 1 + IV_LENGTH)
    const authTag = data.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = data.subarray(1 + IV_LENGTH + AUTH_TAG_LENGTH)
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(authTag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch (cause) {
      throw new DecryptionError(
        'decrypt: authentication failed — tampered ciphertext, wrong key, or mismatched AAD',
        { cause },
      )
    }
  }
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
    throw new Error('EncryptionService key must be exactly 32 bytes (256 bits)')
  }
}

/**
 * Deterministic HMAC-SHA256 "blind index" for an encrypted value (e.g. employees.pesel).
 * Because AES-GCM uses a random IV, two encryptions of the same PESEL differ, so the
 * ciphertext column cannot be uniquely-indexed or equality-searched. Store this hash in a
 * sibling column with a UNIQUE index to enforce per-tenant PESEL uniqueness and to enable
 * lookup-by-PESEL without scanning + decrypting every row. Use a key SEPARATE from the
 * encryption key so leaking one does not compromise the other.
 */
export function hmacBlindIndex(value: string, key: Buffer): string {
  assertKey(key)
  return createHmac('sha256', key).update(value, 'utf8').digest('hex')
}

/** Constant-time compare of two blind-index hex digests (avoids timing leaks on lookup). */
export function blindIndexEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
