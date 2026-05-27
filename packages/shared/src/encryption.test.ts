import { randomBytes } from 'node:crypto'
import { EncryptionService } from './encryption.js'

const key = randomBytes(32) // 256-bit test key

describe('EncryptionService', () => {
  it('round-trips a value through encrypt → decrypt', () => {
    const svc = new EncryptionService(key)
    const plaintext = '44051401359' // sample 11-digit PESEL shape
    expect(svc.decrypt(svc.encrypt(plaintext))).toBe(plaintext)
  })

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const svc = new EncryptionService(key)
    const a = svc.encrypt('same-value')
    const b = svc.encrypt('same-value')
    expect(a).not.toBe(b)
    // both still decrypt back to the original
    expect(svc.decrypt(a)).toBe('same-value')
    expect(svc.decrypt(b)).toBe('same-value')
  })

  it('throws when decrypting tampered ciphertext (GCM auth tag)', () => {
    const svc = new EncryptionService(key)
    const encrypted = svc.encrypt('integrity-protected')
    const buf = Buffer.from(encrypted, 'base64')
    buf[buf.length - 1] ^= 0xff // flip last byte of ciphertext
    const tampered = buf.toString('base64')
    expect(() => svc.decrypt(tampered)).toThrow()
  })

  it('rejects a key that is not exactly 32 bytes', () => {
    expect(() => new EncryptionService(randomBytes(31))).toThrow(/32 bytes/)
  })
})
