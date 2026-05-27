import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // bytes — per Foundation spec
const AUTH_TAG_LENGTH = 16 // bytes — GCM tag

/**
 * Application-layer authenticated encryption for sensitive PII (employees.pesel)
 * and secrets at rest (tenants.db_url). AES-256-GCM: confidentiality + integrity.
 *
 * Stored format (base64): [IV (16B)][authTag (16B)][ciphertext].
 * A fresh random IV per call means identical plaintexts yield distinct
 * ciphertexts — ECB-style pattern leakage is impossible.
 */
export class EncryptionService {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('EncryptionService key must be exactly 32 bytes (256 bits)')
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
  }

  decrypt(payload: string): string {
    const data = Buffer.from(payload, 'base64')
    const iv = data.subarray(0, IV_LENGTH)
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
}
