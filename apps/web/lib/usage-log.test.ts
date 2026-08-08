import { describe, expect, it } from 'vitest'
import { buildUsageEvent, normaliseRoute } from './usage-log'

/**
 * Usage events must answer "which screen is used" WITHOUT building a per-employee behaviour trail.
 * The tests below are mostly about what must NOT be in the event.
 */

/** Build an unsigned JWT with the given claims — the gate only base64-decodes, it never verifies. */
function tokenWith(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`
}

const NOW = new Date('2026-08-08T12:00:00.000Z')
const TOKEN = tokenWith({
  iss: 'http://keycloak:8080/realms/hrobot-4mobility',
  hrobot_roles: ['MANAGER', 'PRACOWNIK'],
  sub: 'c0ffee00-1111-2222-3333-444455556666',
  preferred_username: 'anna.kowalska',
  name: 'Anna Kowalska',
})

describe('normaliseRoute', () => {
  it('collapses a uuid segment to :id', () => {
    expect(normaliseRoute('/pracownicy/8f2c1d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f')).toBe('/pracownicy/:id')
  })

  it('collapses numeric and long opaque identifiers', () => {
    expect(normaliseRoute('/api/dokumenty/12345')).toBe('/api/dokumenty/:id')
    expect(normaliseRoute('/api/grafik/aGVsbG8td29ybGQtdG9rZW4')).toBe('/api/grafik/:id')
  })

  it('keeps real route structure so two screens never merge into one row', () => {
    // Over-collapsing would silently destroy the metric this module exists to produce. REGRESSION:
    // the first implementation collapsed any 16+ char [A-Za-z0-9_-] segment, which turned
    // `ai-grafik-manager` (17 chars) into `:id`. Every real tenant route is asserted here.
    for (const route of [
      'dashboard',
      'grafik',
      'pracownicy',
      'wnioski',
      'zamiany',
      'dostepy',
      'dokumenty',
      'analiza',
      'analityk',
      'asystent',
      'profil',
      'ustawienia',
      'ai-grafik-manager',
    ]) {
      expect(normaliseRoute(`/${route}`)).toBe(`/${route}`)
    }
    expect(normaliseRoute('/ustawienia/uzytkownicy')).toBe('/ustawienia/uzytkownicy')
    expect(normaliseRoute('/api/shift-swap')).toBe('/api/shift-swap')
    expect(normaliseRoute('/api/strategic-brain/recruitment')).toBe('/api/strategic-brain/recruitment')
  })

  it('normalises the root and trailing slashes', () => {
    expect(normaliseRoute('/')).toBe('/')
    expect(normaliseRoute('/grafik/')).toBe('/grafik')
  })
})

describe('buildUsageEvent', () => {
  it('records the tenant realm and roles, never the person', () => {
    const evt = buildUsageEvent({ pathname: '/grafik', method: 'GET', status: 200, token: TOKEN, now: NOW })

    expect(evt).toEqual({
      evt: 'app_usage',
      ts: '2026-08-08T12:00:00.000Z',
      tenant: 'hrobot-4mobility',
      roles: ['MANAGER', 'PRACOWNIK'],
      surface: 'screen',
      route: '/grafik',
      method: 'GET',
      status: 200,
    })
  })

  it('[RODO] carries no person identifier even though the token holds several', () => {
    const evt = buildUsageEvent({ pathname: '/grafik', method: 'GET', status: 200, token: TOKEN, now: NOW })
    const serialised = JSON.stringify(evt)

    // The token contains all three; none may reach the log line.
    expect(serialised).not.toContain('c0ffee00')
    expect(serialised).not.toContain('anna.kowalska')
    expect(serialised).not.toContain('Anna Kowalska')
    expect(Object.keys(evt).sort()).toEqual(
      ['evt', 'method', 'roles', 'route', 'status', 'surface', 'tenant', 'ts'].sort(),
    )
  })

  it('[RODO] strips the employee id out of a record-detail route', () => {
    const evt = buildUsageEvent({
      pathname: '/pracownicy/8f2c1d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
      method: 'GET',
      status: 200,
      token: TOKEN,
      now: NOW,
    })

    expect(evt.route).toBe('/pracownicy/:id')
    expect(JSON.stringify(evt)).not.toContain('8f2c1d3e')
  })

  it('tells an API call apart from a screen navigation', () => {
    const api = buildUsageEvent({ pathname: '/api/employees', method: 'POST', status: 201, token: TOKEN, now: NOW })
    const screen = buildUsageEvent({ pathname: '/pracownicy', method: 'GET', status: 200, token: TOKEN, now: NOW })
    const bare = buildUsageEvent({ pathname: '/api', method: 'GET', status: 401, token: undefined, now: NOW })

    expect(api.surface).toBe('api')
    expect(screen.surface).toBe('screen')
    expect(bare.surface).toBe('api')
  })

  it('records a rejected anonymous request with no tenant and no roles', () => {
    // The 401s are the point: they show a screen being reached without a session.
    const evt = buildUsageEvent({ pathname: '/api/employees', method: 'GET', status: 401, token: undefined, now: NOW })

    expect(evt.tenant).toBeNull()
    expect(evt.roles).toEqual([])
    expect(evt.status).toBe(401)
  })

  it('survives a malformed or non-JWT cookie without throwing', () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.!!!not-base64!!!.c']) {
      const evt = buildUsageEvent({ pathname: '/grafik', method: 'GET', status: 200, token: bad, now: NOW })
      expect(evt.tenant).toBeNull()
      expect(evt.roles).toEqual([])
    }
  })

  it('ignores a non-array or non-string roles claim', () => {
    const weird = tokenWith({ iss: 'http://kc/realms/r', hrobot_roles: 'ADMIN_KLIENTA' })
    const mixed = tokenWith({ iss: 'http://kc/realms/r', hrobot_roles: ['HR', 42, null] })

    expect(buildUsageEvent({ pathname: '/x', method: 'GET', status: 200, token: weird, now: NOW }).roles).toEqual([])
    expect(buildUsageEvent({ pathname: '/x', method: 'GET', status: 200, token: mixed, now: NOW }).roles).toEqual(['HR'])
  })

  it("drops Keycloak's built-in roles and keeps only the app's own", () => {
    // Observed on the live stack: the hrobot_roles claim carries realm built-ins alongside the app
    // roles. They say nothing about who is using a screen and are data we have no reason to retain.
    const realistic = tokenWith({
      iss: 'http://keycloak:8080/realms/hrobot-staging',
      hrobot_roles: ['default-roles-hrobot-staging', 'offline_access', 'PRACOWNIK', 'uma_authorization'],
    })

    const evt = buildUsageEvent({ pathname: '/moj-tydzien', method: 'GET', status: 0, token: realistic, now: NOW })

    expect(evt.roles).toEqual(['PRACOWNIK'])
  })
})
