import { describe, it, expect } from 'vitest'
import { isTenantRoute } from '@/middleware'

describe('isTenantRoute', () => {
  it('matches /dashboard exactly', () => expect(isTenantRoute('/dashboard')).toBe(true))
  it('matches /pracownicy exactly', () => expect(isTenantRoute('/pracownicy')).toBe(true))
  it('matches /pracownicy/1 sub-path', () => expect(isTenantRoute('/pracownicy/1')).toBe(true))
  it('matches /pracownicy/1/edit deep sub-path', () => expect(isTenantRoute('/pracownicy/1/edit')).toBe(true))
  it('matches /grafik exactly', () => expect(isTenantRoute('/grafik')).toBe(true))
  it('matches /wnioski exactly', () => expect(isTenantRoute('/wnioski')).toBe(true))
  it('matches /dostepy exactly', () => expect(isTenantRoute('/dostepy')).toBe(true))
  it('matches /ustawienia exactly', () => expect(isTenantRoute('/ustawienia')).toBe(true))
  it('matches /ustawienia/placowki sub-path', () => expect(isTenantRoute('/ustawienia/placowki')).toBe(true))
  it('matches /ustawienia/uzytkownicy sub-path', () => expect(isTenantRoute('/ustawienia/uzytkownicy')).toBe(true))
  it('does NOT match /', () => expect(isTenantRoute('/')).toBe(false))
  it('does NOT match /login', () => expect(isTenantRoute('/login')).toBe(false))
  it('does NOT match /signup', () => expect(isTenantRoute('/signup')).toBe(false))
  it('does NOT match /api/auth/signin', () => expect(isTenantRoute('/api/auth/signin')).toBe(false))
  it('does NOT match /dashboardX (prefix collision)', () => expect(isTenantRoute('/dashboardX')).toBe(false))
})
