import { createHmac } from 'node:crypto'
import type { EncryptionService } from '@hrobot/shared'
import { encryptEmployeePesel } from '../employeePii.js'
import { assertSyntheticPesel } from './pesel.js'
import type { SeedEmployee } from './canonicalData.js'

/**
 * PII-encryption glue between the pure canonical dataset and the DB runner. Kept out of both
 * canonicalData.ts (which stays crypto-free and importable by Tor C/E) and the Prisma runner (which
 * stays a thin write loop), so the RODO-critical encryption path is unit-testable without a database.
 */

/** Stable synthetic tenant id used for PII AAD when the runner is given none. */
export const DEFAULT_SEED_TENANT_ID = '00000000-0000-4000-8000-000000000001'

/** AAD binding home-address ciphertext to its tenant + column (parallels employeePii's PESEL AAD). */
export const homeAddressAad = (tenantId: string): string => `tenant:${tenantId}:employee.homeAddress`

/**
 * Derive the 32-byte PESEL blind-index key from the AES master key via HMAC (domain-separated), so
 * the seed needs only the existing TENANT_DB_ENCRYPTION_KEY — no separate blind-index env var to
 * invent. HMAC is one-way, so the derived key never discloses the master. The derivation is fixed, so
 * `peselHash` is stable across runs, which is what makes the upsert idempotent.
 */
export function deriveBlindIndexKey(masterKeyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
    throw new Error('deriveBlindIndexKey: master key must be 64 hex chars (32 bytes)')
  }
  const master = Buffer.from(masterKeyHex, 'hex')
  return createHmac('sha256', master).update('hrobot:employee.pesel:blind-index:v1').digest()
}

export interface EncryptedEmployeePii {
  /** AES-256-GCM ciphertext → employees.pesel */
  pesel: string
  /** deterministic blind index → employees.pesel_hash (UNIQUE, stable across runs) */
  peselHash: string
  /** AES-256-GCM ciphertext → employees.home_address */
  homeAddress: string
}

/**
 * Produce the encrypted-at-rest PII fields for one employee. RODO §9 hard refusal: the PESEL must be
 * a branded synthetic value ({@link assertSyntheticPesel}) or this throws before anything is encrypted
 * or persisted. Home address is encrypted under its own AAD; the derived lat/lng stay plaintext (not
 * PII on their own).
 */
export function encryptEmployeePii(
  enc: EncryptionService,
  blindIndexKey: Buffer,
  tenantId: string,
  employee: SeedEmployee,
): EncryptedEmployeePii {
  const peselPlain = assertSyntheticPesel(employee.pesel)
  const { pesel, peselHash } = encryptEmployeePesel(enc, blindIndexKey, tenantId, peselPlain)
  return {
    pesel,
    peselHash,
    homeAddress: enc.encrypt(employee.homeAddress, homeAddressAad(tenantId)),
  }
}
