import { randomBytes } from 'node:crypto'
import { EncryptionService } from '@hrobot/shared'
import {
  encryptEmployeePesel,
  decryptEmployeePesel,
  employeePeselBlindIndex,
} from './employeePii.js'

const enc = new EncryptionService(randomBytes(32))
const biKey = randomBytes(32)

describe('employee PESEL helpers', () => {
  it('encrypts + blind-indexes and round-trips within the same tenant context', () => {
    const { pesel, peselHash } = encryptEmployeePesel(enc, biKey, 't1', '44051401359')
    expect(pesel).not.toContain('44051401359') // ciphertext, not plaintext
    expect(peselHash).toBe(employeePeselBlindIndex(biKey, '44051401359'))
    expect(decryptEmployeePesel(enc, 't1', pesel)).toBe('44051401359')
  })

  it('blind index is stable across encryptions (enables UNIQUE + lookup) while ciphertext varies', () => {
    const a = encryptEmployeePesel(enc, biKey, 't1', '44051401359')
    const b = encryptEmployeePesel(enc, biKey, 't1', '44051401359')
    expect(a.pesel).not.toBe(b.pesel) // random IV
    expect(a.peselHash).toBe(b.peselHash) // deterministic blind index
  })

  it('normalizes surrounding whitespace so it dedupes', () => {
    expect(employeePeselBlindIndex(biKey, '  44051401359 ')).toBe(
      employeePeselBlindIndex(biKey, '44051401359'),
    )
  })

  it('fails to decrypt under a different tenant context (AAD binding)', () => {
    const { pesel } = encryptEmployeePesel(enc, biKey, 't1', '44051401359')
    expect(() => decryptEmployeePesel(enc, 't2', pesel)).toThrow()
  })
})
