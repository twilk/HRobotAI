import { EncryptionService, hmacBlindIndex } from '@hrobot/shared'

/**
 * Guard rails for storing/reading an employee's PESEL (Polish national ID). The Prisma schema
 * types `pesel` as a plain `String`, so nothing structurally stops a caller from persisting
 * plaintext PII. Always build the encrypted value + blind index through these helpers instead
 * of assigning `pesel` directly:
 *
 *   await tenant.employee.create({ data: { ...rest, ...encryptEmployeePesel(enc, biKey, tenantId, pesel) } })
 *   const found = await tenant.employee.findUnique({ where: { peselHash: employeePeselBlindIndex(biKey, pesel) } })
 *   const pesel = decryptEmployeePesel(enc, tenantId, found.pesel)
 *
 * `enc` is the AES-256-GCM EncryptionService; `biKey` is a SEPARATE 32-byte HMAC key for the
 * blind index. The ciphertext is bound to the tenant via AAD, so a blob can't be moved between
 * tenants and still decrypt.
 */

const peselAad = (tenantId: string): string => `tenant:${tenantId}:employee.pesel`

/** Normalize before encrypting/hashing so "  44051401359 " and "44051401359" are one identity. */
function normalizePesel(pesel: string): string {
  return pesel.trim()
}

export interface EncryptedPesel {
  /** AES-256-GCM ciphertext → employees.pesel */
  pesel: string
  /** HMAC-SHA256 blind index → employees.pesel_hash (UNIQUE) */
  peselHash: string
}

/** Encrypt a PESEL and compute its blind index for an employee INSERT/UPDATE. */
export function encryptEmployeePesel(
  enc: EncryptionService,
  blindIndexKey: Buffer,
  tenantId: string,
  pesel: string,
): EncryptedPesel {
  const normalized = normalizePesel(pesel)
  return {
    pesel: enc.encrypt(normalized, peselAad(tenantId)),
    peselHash: hmacBlindIndex(normalized, blindIndexKey),
  }
}

/** Decrypt an employee's stored PESEL ciphertext (same tenantId used to encrypt). */
export function decryptEmployeePesel(
  enc: EncryptionService,
  tenantId: string,
  ciphertext: string,
): string {
  return enc.decrypt(ciphertext, peselAad(tenantId))
}

/** Blind index for a lookup-by-PESEL: `where: { peselHash: employeePeselBlindIndex(biKey, pesel) }`. */
export function employeePeselBlindIndex(blindIndexKey: Buffer, pesel: string): string {
  return hmacBlindIndex(normalizePesel(pesel), blindIndexKey)
}
