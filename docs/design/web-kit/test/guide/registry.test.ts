import { describe, it, expect } from 'vitest'
import { resolveSpace, SPACES, getSpaceLabel } from '@/lib/guide/registry'

describe('resolveSpace', () => {
  it('resolves /dashboard → dashboard', () => {
    expect(resolveSpace('/dashboard')).toBe('dashboard')
  })

  it('resolves /pracownicy → pracownicy (exact, not prefix)', () => {
    expect(resolveSpace('/pracownicy')).toBe('pracownicy')
  })

  it('resolves /pracownicy/123 → pracownicy-id (prefix match)', () => {
    expect(resolveSpace('/pracownicy/abc-123')).toBe('pracownicy-id')
  })

  it('resolves /grafik → grafik', () => {
    expect(resolveSpace('/grafik')).toBe('grafik')
  })

  it('resolves /wnioski → wnioski', () => {
    expect(resolveSpace('/wnioski')).toBe('wnioski')
  })

  it('resolves /dostepy → dostepy', () => {
    expect(resolveSpace('/dostepy')).toBe('dostepy')
  })

  it('resolves /ustawienia/placowki → ustawienia-placowki (before /ustawienia)', () => {
    expect(resolveSpace('/ustawienia/placowki')).toBe('ustawienia-placowki')
  })

  it('resolves /ustawienia/uzytkownicy → ustawienia-uzytkownicy', () => {
    expect(resolveSpace('/ustawienia/uzytkownicy')).toBe('ustawienia-uzytkownicy')
  })

  it('resolves /ustawienia → ustawienia', () => {
    expect(resolveSpace('/ustawienia')).toBe('ustawienia')
  })

  it('returns null for unknown paths', () => {
    expect(resolveSpace('/login')).toBeNull()
    expect(resolveSpace('/')).toBeNull()
    expect(resolveSpace('/signup')).toBeNull()
    expect(resolveSpace('')).toBeNull()
  })

  it('SPACES array exports 9 spaces', () => {
    expect(SPACES).toHaveLength(9)
  })
})

describe('getSpaceLabel', () => {
  it('returns the human-readable label for a valid space id', () => {
    expect(getSpaceLabel('dashboard')).toBe('Dashboard')
    expect(getSpaceLabel('pracownicy')).toBe('Pracownicy')
    expect(getSpaceLabel('pracownicy-id')).toBe('Kartoteka pracownika')
  })

  it('falls back to the id itself for an unknown space id', () => {
    // TypeScript cast lets us pass an arbitrary string to exercise the fallback branch
    expect(getSpaceLabel('unknown-space' as any)).toBe('unknown-space')
  })
})
