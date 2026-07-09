import { EncryptionService } from '@hrobot/shared'
import { decryptEmployeePesel } from '../employeePii.js'
import { buildCanonicalSeed } from './canonicalData.js'
import { generateSyntheticPesel } from './pesel.js'
import {
  DEFAULT_SEED_TENANT_ID,
  deriveBlindIndexKey,
  encryptEmployeePii,
  homeAddressAad,
} from './persist.js'

const KEY_HEX = 'a'.repeat(64) // 32-byte test key
const enc = EncryptionService.fromHexKey(KEY_HEX)
const biKey = deriveBlindIndexKey(KEY_HEX)

describe('seed persist (PII encryption wiring the runner uses)', () => {
  const employee = buildCanonicalSeed().employees[0]!

  it('encrypts PESEL round-trippably and never stores it in plaintext', () => {
    const pii = encryptEmployeePii(enc, biKey, DEFAULT_SEED_TENANT_ID, employee)
    expect(pii.pesel).not.toContain(employee.pesel.value) // ciphertext, not plaintext
    expect(decryptEmployeePesel(enc, DEFAULT_SEED_TENANT_ID, pii.pesel)).toBe(employee.pesel.value)
  })

  it('encrypts homeAddress round-trippably under its own AAD (never plaintext)', () => {
    const pii = encryptEmployeePii(enc, biKey, DEFAULT_SEED_TENANT_ID, employee)
    expect(pii.homeAddress).not.toContain('ul.')
    expect(pii.homeAddress).not.toContain(employee.homeAddress)
    expect(enc.decrypt(pii.homeAddress, homeAddressAad(DEFAULT_SEED_TENANT_ID))).toBe(
      employee.homeAddress,
    )
  })

  it('produces a STABLE peselHash across runs (idempotent upsert key)', () => {
    const a = encryptEmployeePii(enc, biKey, DEFAULT_SEED_TENANT_ID, employee)
    const b = encryptEmployeePii(enc, biKey, DEFAULT_SEED_TENANT_ID, employee)
    expect(a.peselHash).toBe(b.peselHash) // deterministic blind index → re-run is a no-op
    expect(a.pesel).not.toBe(b.pesel) // ciphertext still fresh per call (random IV)
  })

  it('derives the blind-index key from the master key only, domain-separated', () => {
    // deterministic + 32 bytes + not equal to the raw master key
    expect(deriveBlindIndexKey(KEY_HEX)).toEqual(deriveBlindIndexKey(KEY_HEX))
    expect(deriveBlindIndexKey(KEY_HEX)).toHaveLength(32)
    expect(deriveBlindIndexKey(KEY_HEX).toString('hex')).not.toBe(KEY_HEX)
  })

  it('RODO refusal propagates: a non-synthetic PESEL is never encrypted', () => {
    const forged = { ...employee, pesel: '44051401359' as unknown as typeof employee.pesel }
    expect(() => encryptEmployeePii(enc, biKey, DEFAULT_SEED_TENANT_ID, forged)).toThrow(
      /RODO refusal/,
    )
  })

  it('is checksum-consistent with the standalone generator', () => {
    // sanity: the employee's PESEL is exactly what the generator makes for index 0
    expect(employee.pesel.value).toBe(generateSyntheticPesel(0, 'M').value)
  })
})
