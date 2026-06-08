import { randomBytes } from 'node:crypto'
import { EncryptionService, DecryptionError, hmacBlindIndex, blindIndexEquals } from './encryption.js'

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
    expect(svc.decrypt(a)).toBe('same-value')
    expect(svc.decrypt(b)).toBe('same-value')
  })

  it('throws DecryptionError when decrypting tampered ciphertext (GCM auth tag)', () => {
    const svc = new EncryptionService(key)
    const buf = Buffer.from(svc.encrypt('integrity-protected'), 'base64')
    buf[buf.length - 1] ^= 0xff // flip last byte of ciphertext
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow(DecryptionError)
  })

  it('rejects a key that is not exactly 32 bytes', () => {
    expect(() => new EncryptionService(randomBytes(31))).toThrow(/32 bytes/)
  })

  it('writes a version byte and a 12-byte IV', () => {
    const svc = new EncryptionService(key)
    const data = Buffer.from(svc.encrypt('x'), 'base64')
    expect(data[0]).toBe(1) // key version 1
    expect(data.length).toBeGreaterThanOrEqual(1 + 12 + 16 + 1) // ver + iv(12) + tag(16) + ciphertext
  })

  it('fromHexKey builds from 64 hex chars and round-trips; rejects bad input', () => {
    const svc = EncryptionService.fromHexKey(key.toString('hex'))
    expect(svc.decrypt(svc.encrypt('pii'))).toBe('pii')
    expect(() => EncryptionService.fromHexKey('tooshort')).toThrow(/64 hex/)
  })

  it('throws DecryptionError on empty or too-short payloads', () => {
    const svc = new EncryptionService(key)
    expect(() => svc.decrypt('')).toThrow(DecryptionError)
    expect(() => svc.decrypt('AAAA')).toThrow(DecryptionError) // decodes to 3 bytes < min
  })

  it('throws DecryptionError when decrypting with the wrong key', () => {
    const a = new EncryptionService(key)
    const b = new EncryptionService(randomBytes(32))
    expect(() => b.decrypt(a.encrypt('secret'))).toThrow(DecryptionError)
  })

  it('binds ciphertext to AAD context (mismatched or missing AAD fails)', () => {
    const svc = new EncryptionService(key)
    const ct = svc.encrypt('44051401359', 'tenant:a:pesel')
    expect(svc.decrypt(ct, 'tenant:a:pesel')).toBe('44051401359')
    expect(() => svc.decrypt(ct, 'tenant:b:pesel')).toThrow(DecryptionError)
    expect(() => svc.decrypt(ct)).toThrow(DecryptionError)
  })

  it('supports key rotation via a keyring (old version still decrypts, new uses active)', () => {
    const k1 = randomBytes(32)
    const k2 = randomBytes(32)
    const v1 = new EncryptionService({ keys: { 1: k1 }, activeVersion: 1 })
    const legacy = v1.encrypt('legacy')

    const rotated = new EncryptionService({ keys: { 1: k1, 2: k2 }, activeVersion: 2 })
    expect(rotated.decrypt(legacy)).toBe('legacy') // old ciphertext still readable
    const fresh = rotated.encrypt('new')
    expect(Buffer.from(fresh, 'base64')[0]).toBe(2) // new ciphertext uses active version 2
    expect(rotated.decrypt(fresh)).toBe('new')
  })

  it('rejects a keyring whose activeVersion has no key', () => {
    expect(() => new EncryptionService({ keys: { 1: key }, activeVersion: 2 })).toThrow(/activeVersion/)
  })
})

describe('hmacBlindIndex', () => {
  it('is deterministic for the same value+key and differs across keys', () => {
    const k = randomBytes(32)
    const a = hmacBlindIndex('44051401359', k)
    expect(a).toBe(hmacBlindIndex('44051401359', k))
    expect(hmacBlindIndex('44051401359', randomBytes(32))).not.toBe(a)
    expect(blindIndexEquals(a, hmacBlindIndex('44051401359', k))).toBe(true)
  })

  it('rejects a key that is not 32 bytes', () => {
    expect(() => hmacBlindIndex('x', randomBytes(16))).toThrow(/32 bytes/)
  })
})
