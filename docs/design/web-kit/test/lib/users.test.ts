import { describe, it, expect } from 'vitest'
import { getUsers, roleLabel } from '@/lib/users'

describe('users lib', () => {
  it('returns non-empty users array', () => {
    expect(getUsers().length).toBeGreaterThan(0)
  })

  it('contains admin, manager, hr, and pracownik roles', () => {
    const allRoles = getUsers().flatMap((u) => u.roles)
    expect(allRoles).toContain('ADMIN_KLIENTA')
    expect(allRoles).toContain('MANAGER')
    expect(allRoles).toContain('HR')
    expect(allRoles).toContain('PRACOWNIK')
  })

  it('roleLabel returns Polish strings', () => {
    expect(roleLabel('ADMIN_KLIENTA')).toBe('Admin klienta')
    expect(roleLabel('PRACOWNIK')).toBe('Pracownik')
    expect(roleLabel('HR')).toBe('HR')
    expect(roleLabel('MANAGER')).toBe('Manager')
  })

  it('at least one invited user exists', () => {
    expect(getUsers().some((u) => u.status === 'invited')).toBe(true)
  })
})
