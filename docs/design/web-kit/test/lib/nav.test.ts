import { describe, it, expect } from 'vitest'
import { visibleGroups, type Role } from '@/lib/nav'

const labels = (roles: Role[]) => visibleGroups(roles).flatMap((g) => g.items.map((i) => i.label))

describe('nav RBAC visibility', () => {
  it('PRACOWNIK sees only role-open modules (no Administracja, no Dostępy)', () => {
    const l = labels(['PRACOWNIK'])
    expect(l).toContain('Dashboard')
    expect(l).toContain('Pracownicy')
    expect(l).not.toContain('Dostępy')
    expect(l).not.toContain('Ustawienia')
    expect(l).not.toContain('Użytkownicy')
  })

  it('ADMIN_KLIENTA sees administracja + Dostępy', () => {
    const l = labels(['ADMIN_KLIENTA'])
    expect(l).toContain('Dostępy')
    expect(l).toContain('Ustawienia')
    expect(l).toContain('Użytkownicy')
  })

  it('drops empty groups', () => {
    // PRACOWNIK has no Administracja items -> the group is filtered out entirely
    expect(visibleGroups(['PRACOWNIK']).some((g) => g.label === 'Administracja')).toBe(false)
  })
})
