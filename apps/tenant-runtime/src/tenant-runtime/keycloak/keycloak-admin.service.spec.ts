import { Test, TestingModule } from '@nestjs/testing'
import { Role } from '@hrobot/shared'
import { KeycloakAdminService } from './keycloak-admin.service.js'

const mockFetch = jest.fn()

const REALM = 'hrobot-acme'

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string }

/** Build a Response-like object for the injected fetch mock. */
const res = (opts: { status?: number; body?: unknown; location?: string | null }) =>
  Promise.resolve({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    headers: { get: (name: string) => (name === 'Location' ? (opts.location ?? null) : null) },
    json: async () => opts.body ?? {},
  })

/** URL/method-aware happy-path Keycloak Admin API mock, order-independent. */
function happyPathFetch(url: string, init: FetchInit = {}): Promise<unknown> {
  const method = init.method ?? 'GET'
  if (url.includes('/protocol/openid-connect/token')) return res({ body: { access_token: 'tok' } })
  if (method === 'GET' && /\/roles\/[^/?]+$/.test(url)) {
    return res({ body: { id: 'role-uuid-manager', name: 'MANAGER' } })
  }
  if (method === 'GET' && url.includes('/users?')) return res({ body: [{ id: 'kc-user-1' }] })
  if (method === 'POST' && /\/users$/.test(url)) {
    return res({ status: 201, location: `http://kc/admin/realms/${REALM}/users/kc-user-1` })
  }
  return res({ status: 200 })
}

describe('KeycloakAdminService', () => {
  let service: KeycloakAdminService

  const callsTo = (predicate: (url: string, init: FetchInit) => boolean): Array<[string, FetchInit]> =>
    (mockFetch.mock.calls as Array<[string, FetchInit]>).filter(([url, init]) => predicate(url, init ?? {}))

  beforeEach(async () => {
    process.env['KEYCLOAK_URL'] = 'http://localhost:8080'
    process.env['KEYCLOAK_ADMIN_CLIENT_SECRET'] = 'admin-secret'
    process.env['CONTROL_PLANE_DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db'
    process.env['TENANT_DB_ENCRYPTION_KEY'] = 'a'.repeat(64)
    process.env['KEYCLOAK_CLIENT_ID'] = 'hrobot-web'
    process.env['REDIS_URL'] = 'redis://localhost:6379'
    process.env['RABBITMQ_URL'] = 'amqp://localhost:5672'
    process.env['NEXTAUTH_SECRET'] = 'secret'
    process.env['POSTGRES_SUPERUSER_URL'] = 'postgresql://postgres:postgres@localhost:5433/postgres'
    process.env['GLOBAL_ADMIN_JWT_SECRET'] = 'a'.repeat(32)

    const module: TestingModule = await Test.createTestingModule({
      providers: [KeycloakAdminService, { provide: 'FETCH', useValue: mockFetch }],
    }).compile()
    service = module.get(KeycloakAdminService)

    jest.clearAllMocks()
    mockFetch.mockImplementation(happyPathFetch)
  })

  describe('createUser', () => {
    it('reads the kcId from the Location header of a 201 and reports created:true', async () => {
      const result = await service.createUser(REALM, 'new@acme.com')
      expect(result).toEqual({ kcId: 'kc-user-1', created: true })

      const createCalls = callsTo((url, init) => init.method === 'POST' && /\/users$/.test(url))
      expect(createCalls).toHaveLength(1)
      expect(JSON.parse(createCalls[0]![1].body ?? '{}')).toEqual({
        username: 'new@acme.com',
        email: 'new@acme.com',
        enabled: true,
      })
    })

    it('falls back to an exact-email lookup when a 409 carries no Location (retried invite), and reports created:false', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'POST' && /\/users$/.test(url)) return res({ status: 409 })
        return happyPathFetch(url, init)
      })

      const result = await service.createUser(REALM, 'existing@acme.com')
      expect(result).toEqual({ kcId: 'kc-user-1', created: false })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/users?email=existing%40acme.com&exact=true'),
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('throws when neither Location nor email lookup resolves a kcId', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'POST' && /\/users$/.test(url)) return res({ status: 409 })
        if (init.method === 'GET' && url.includes('/users?')) return res({ body: [] })
        return happyPathFetch(url, init)
      })

      await expect(service.createUser(REALM, 'ghost@acme.com')).rejects.toThrow(/could not resolve kcId/)
    })

    it('throws on a non-409 Keycloak error', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'POST' && /\/users$/.test(url)) return res({ status: 500 })
        return happyPathFetch(url, init)
      })

      await expect(service.createUser(REALM, 'boom@acme.com')).rejects.toThrow()
    })
  })

  describe('assignRealmRole / removeRealmRole', () => {
    it('fetches the role representation then POSTs the mapping to grant', async () => {
      await service.assignRealmRole(REALM, 'kc-user-1', 'MANAGER')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/realms/${REALM}/roles/MANAGER`),
        expect.objectContaining({ method: 'GET' }),
      )
      const assignCalls = callsTo((url, init) => init.method === 'POST' && /\/role-mappings\/realm$/.test(url))
      expect(assignCalls).toHaveLength(1)
      expect(JSON.parse(assignCalls[0]![1].body ?? '[]')).toEqual([{ id: 'role-uuid-manager', name: 'MANAGER' }])
    })

    it('fetches the role representation then DELETEs the mapping to revoke', async () => {
      await service.removeRealmRole(REALM, 'kc-user-1', 'MANAGER')

      const removeCalls = callsTo((url, init) => init.method === 'DELETE' && /\/role-mappings\/realm$/.test(url))
      expect(removeCalls).toHaveLength(1)
      expect(JSON.parse(removeCalls[0]![1].body ?? '[]')).toEqual([{ id: 'role-uuid-manager', name: 'MANAGER' }])
    })

    it('tolerates a 409 on grant (already assigned) as success', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'POST' && /\/role-mappings\/realm$/.test(url)) return res({ status: 409 })
        return happyPathFetch(url, init)
      })
      await expect(service.assignRealmRole(REALM, 'kc-user-1', 'MANAGER')).resolves.toBeUndefined()
    })

    it('tolerates a 409 on revoke (already removed) as success', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'DELETE' && /\/role-mappings\/realm$/.test(url)) return res({ status: 409 })
        return happyPathFetch(url, init)
      })
      await expect(service.removeRealmRole(REALM, 'kc-user-1', 'MANAGER')).resolves.toBeUndefined()
    })

    it('throws on a non-409 error from grant', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'POST' && /\/role-mappings\/realm$/.test(url)) return res({ status: 500 })
        return happyPathFetch(url, init)
      })
      await expect(service.assignRealmRole(REALM, 'kc-user-1', 'MANAGER')).rejects.toThrow()
    })
  })

  describe('sendPasswordSetupEmail', () => {
    it('is best-effort: a non-ok response does not throw', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'PUT' && /\/execute-actions-email$/.test(url)) return res({ status: 500 })
        return happyPathFetch(url, init)
      })
      await expect(service.sendPasswordSetupEmail(REALM, 'kc-user-1')).resolves.toBeUndefined()
    })

    it('is best-effort: a thrown network error does not propagate', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'PUT' && /\/execute-actions-email$/.test(url)) return Promise.reject(new Error('ECONNRESET'))
        return happyPathFetch(url, init)
      })
      await expect(service.sendPasswordSetupEmail(REALM, 'kc-user-1')).resolves.toBeUndefined()
    })

    it('sends the UPDATE_PASSWORD required action on success', async () => {
      await service.sendPasswordSetupEmail(REALM, 'kc-user-1')
      const emailCalls = callsTo((url, init) => init.method === 'PUT' && /\/execute-actions-email$/.test(url))
      expect(emailCalls).toHaveLength(1)
      expect(JSON.parse(emailCalls[0]![1].body ?? '[]')).toEqual(['UPDATE_PASSWORD'])
    })
  })

  describe('setEnabled', () => {
    it('PUTs the enabled flag (used to disable, never delete, on compensation)', async () => {
      await service.setEnabled(REALM, 'kc-user-1', false)
      const putCalls = callsTo((url, init) => init.method === 'PUT' && /\/users\/kc-user-1$/.test(url))
      expect(putCalls).toHaveLength(1)
      expect(JSON.parse(putCalls[0]![1].body ?? '{}')).toEqual({ enabled: false })
    })

    it('throws on a non-409 error', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'PUT' && /\/users\/kc-user-1$/.test(url)) return res({ status: 500 })
        return happyPathFetch(url, init)
      })
      await expect(service.setEnabled(REALM, 'kc-user-1', false)).rejects.toThrow()
    })
  })

  describe('getUserRealmRoles', () => {
    it('returns the realm-role names currently mapped to the KC user', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if ((init.method ?? 'GET') === 'GET' && url.includes('/role-mappings/realm')) {
          return res({ body: [{ id: 'role-uuid-manager', name: 'MANAGER' }, { id: 'role-uuid-hr', name: 'HR' }] })
        }
        return happyPathFetch(url, init)
      })

      const roles = await service.getUserRealmRoles(REALM, 'kc-user-1')
      expect(roles).toEqual(['MANAGER', 'HR'])
    })

    it('throws on a non-409 error', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if ((init.method ?? 'GET') === 'GET' && url.includes('/role-mappings/realm')) return res({ status: 500 })
        return happyPathFetch(url, init)
      })
      await expect(service.getUserRealmRoles(REALM, 'kc-user-1')).rejects.toThrow()
    })
  })

  describe('URL encoding of realm/role path segments', () => {
    it('encodes a realm containing path-traversal characters instead of interpolating it raw', async () => {
      const hostileRealm = '../master'
      await service.setEnabled(hostileRealm, 'kc-user-1', false)

      const putCalls = callsTo((url, init) => init.method === 'PUT' && url.includes('kc-user-1'))
      expect(putCalls).toHaveLength(1)
      expect(putCalls[0]![0]).toContain(encodeURIComponent(hostileRealm))
      expect(putCalls[0]![0]).not.toContain('/admin/realms/../master')
    })

    it('encodes a role containing path-traversal characters instead of interpolating it raw', async () => {
      const hostileRole = '../../clients' as Role
      await service.assignRealmRole(REALM, 'kc-user-1', hostileRole)

      const roleCalls = callsTo((url, init) => (init.method ?? 'GET') === 'GET' && url.includes('/roles/'))
      expect(roleCalls).toHaveLength(1)
      expect(roleCalls[0]![0]).toContain(encodeURIComponent(hostileRole))
      expect(roleCalls[0]![0]).not.toContain(`/roles/${hostileRole}`)
    })

    it('still resolves the real MANAGER role by its typed enum value', async () => {
      await service.assignRealmRole(REALM, 'kc-user-1', Role.MANAGER)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/realms/${REALM}/roles/MANAGER`),
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })
})
