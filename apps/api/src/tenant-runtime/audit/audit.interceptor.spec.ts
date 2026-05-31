import { redactAuditPayload } from './audit.interceptor.js'

describe('redactAuditPayload (P3-4 RODO)', () => {
  it('redacts pesel and credentials anywhere in the body, leaving other fields intact', () => {
    const out = redactAuditPayload({
      firstName: 'Jan',
      pesel: '90010112345',
      nested: { password: 'hunter2', ok: true },
      list: [{ PESEL: 'x', position: 'Dev' }],
    }) as Record<string, unknown>

    expect(out.firstName).toBe('Jan')
    expect(out.pesel).toBe('***')
    const nested = out.nested as Record<string, unknown>
    expect(nested.password).toBe('***')
    expect(nested.ok).toBe(true)
    const first = (out.list as unknown[])[0] as Record<string, unknown>
    expect(first.PESEL).toBe('***') // case-insensitive
    expect(first.position).toBe('Dev')
  })

  it('passes primitives and arrays through unchanged', () => {
    expect(redactAuditPayload('x')).toBe('x')
    expect(redactAuditPayload(42)).toBe(42)
    expect(redactAuditPayload([1, 2])).toEqual([1, 2])
    expect(redactAuditPayload(null)).toBeNull()
  })
})
