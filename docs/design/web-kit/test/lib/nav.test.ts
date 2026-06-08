import { describe, it, expect } from 'vitest'
import { visibleGroups, type Role } from '@/lib/nav'

const labels = (roles: Role[]) => visibleGroups(roles).flatMap((g) => g.items.map((i) => i.label))

describe('nav RBAC visibility', () => {
  it('PRACOWNIK sees only role-open modules (no Administracja, no Dostępy, no Raporty)', () => {
    const l = labels(['PRACOWNIK'])
    expect(l).toContain('Dashboard')
    expect(l).toContain('Pracownicy')
    expect(l).not.toContain('Dostępy')
    expect(l).not.toContain('Raporty')
    expect(l).not.toContain('Ustawienia')
    expect(l).not.toContain('Użytkownicy')
  })

  it('ADMIN_KLIENTA sees administracja + Dostępy + Raporty', () => {
    const l = labels(['ADMIN_KLIENTA'])
    expect(l).toContain('Dostępy')
    expect(l).toContain('Raporty')
    expect(l).toContain('Ustawienia')
    expect(l).toContain('Użytkownicy')
  })

  it('HR role sees Raporty', () => {
    const l = labels(['HR'])
    expect(l).toContain('Raporty')
  })

  it('MANAGER role sees Raporty', () => {
    const l = labels(['MANAGER'])
    expect(l).toContain('Raporty')
  })

  it('Raporty href is /raporty', () => {
    const groups = visibleGroups(['ADMIN_KLIENTA'])
    const raporty = groups.flatMap((g) => g.items).find((i) => i.label === 'Raporty')
    expect(raporty?.href).toBe('/raporty')
  })

  it('drops empty groups', () => {
    // PRACOWNIK has no Administracja items -> the group is filtered out entirely
    expect(visibleGroups(['PRACOWNIK']).some((g) => g.label === 'Administracja')).toBe(false)
  })
})
