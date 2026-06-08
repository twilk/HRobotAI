import { describe, it, expect } from 'vitest'
import { estimate } from '@/components/auth/password-strength'

describe('password estimate heuristic', () => {
  it('scores from empty to strong', () => {
    expect(estimate('')).toBe(0)
    expect(estimate('short')).toBe(0) // < 8 chars
    expect(estimate('abcdefgh')).toBe(1) // length only
    expect(estimate('Abcdefg1')).toBe(2) // length + mixed classes
    expect(estimate('Abcdefghijk1')).toBe(3) // + length >= 12
    expect(estimate('Abcdefghijk1!')).toBe(4) // + special char
  })
})
