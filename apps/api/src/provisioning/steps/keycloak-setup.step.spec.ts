import { Test, TestingModule } from '@nestjs/testing'
import { KeycloakSetupStep, KeycloakNotReadyError } from './keycloak-setup.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { ProvisioningStep, Role } from '@hrobot/shared'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const mockFetch = jest.fn()

const job = { id: 'job-1', tenantId: 'tenant-1', step: ProvisioningStep.KEYCLOAK_SETUP, attemptCount: 0 }
const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  metadata: { adminEmail: 'admin@acme.com' },
}

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string }

/** Build a Response-like object for the injected fetch mock. */
const res = (opts: { status?: number; body?: unknown; location?: string | null }) =>
  Promise.resolve({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    headers: { get: (name: string) => (name === 'Location' ? (opts.location ?? null) : null) },
    json: async () => opts.body ?? {},
  })

/**
 * URL/method-aware happy-path Keycloak Admin API mock. Order-independent, so it survives
 * the extra role-create / role-assign / mapper calls without index juggling.
 */
function happyPathFetch(url: string, init: FetchInit = {}): Promise<unknown> {
  const method = init.method ?? 'GET'
  if (url.includes('/protocol/openid-connect/token')) return res({ body: { access_token: 'tok' } })
  // GET a single realm role representation (…/roles/ADMIN_KLIENTA) → must expose its id
  if (method === 'GET' && /\/roles\/[^/?]+$/.test(url)) return res({ body: { id: 'role-uuid-admin', name: 'ADMIN_KLIENTA' } })
  // look up an existing user by email (retry path, when create returns no Location)
  if (method === 'GET' && url.includes('/users?')) return res({ body: [{ id: 'user-uuid-1' }] })
  // create the initial user → return Location so the userId can be parsed
  if (method === 'POST' && /\/users$/.test(url)) return res({ status: 201, location: 'http://kc/admin/realms/hrobot-acme/users/user-uuid-1' })
  // create the client → return a Location too (realistic; unused by the step)
  if (method === 'POST' && /\/clients$/.test(url)) return res({ status: 201, location: 'http://kc/admin/realms/hrobot-acme/clients/client-uuid-1' })
  // realm-create, role-create, role-mapping assign, execute-actions-email
  return res({ status: 201 })
}

describe('KeycloakSetupStep', () => {
  let step: KeycloakSetupStep

  const callsTo = (predicate: (url: string, init: FetchInit) => boolean): Array<[string, FetchInit]> =>
    (mockFetch.mock.calls as Array<[string, FetchInit]>).filter(([url, init]) => predicate(url, init ?? {}))

  beforeEach(async () => {
    // Env vars required by parseEnv() in KeycloakSetupStep's constructor
    process.env['KEYCLOAK_URL'] = 'http://localhost:8080'
    process.env['KEYCLOAK_ADMIN_PASSWORD'] = 'admin-secret'
    process.env['CONTROL_PLANE_DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db'
    process.env['TENANT_DB_ENCRYPTION_KEY'] = 'a'.repeat(64)
    process.env['REDIS_URL'] = 'redis://localhost:6379'
    process.env['RABBITMQ_URL'] = 'amqp://localhost:5672'
    process.env['NEXTAUTH_SECRET'] = 'secret'
    process.env['POSTGRES_SUPERUSER_URL'] = 'postgresql://postgres:postgres@localhost:5433/postgres'
    process.env['GLOBAL_ADMIN_JWT_SECRET'] = 'a'.repeat(32)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakSetupStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'FETCH', useValue: mockFetch },
      ],
    }).compile()
    step = module.get(KeycloakSetupStep)

    jest.clearAllMocks()
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue(tenant)
    mockPrisma.tenant.update.mockResolvedValue({})
    mockPrisma.provisioningJob.update.mockResolvedValue({})
    mockFetch.mockImplementation(happyPathFetch)
  })

  it('creates one realm role per shared Role enum value (idempotent)', async () => {
    await step.execute(job)

    const roleCreateCalls = callsTo((url, init) => init.method === 'POST' && /\/realms\/hrobot-acme\/roles$/.test(url))
    const createdNames = roleCreateCalls.map(([, init]) => (JSON.parse(init.body ?? '{}') as { name: string }).name)

    expect(createdNames).toEqual(expect.arrayContaining(['PRACOWNIK', 'MANAGER', 'HR', 'ADMIN_KLIENTA']))
    expect(roleCreateCalls).toHaveLength(Object.values(Role).length)
  })

  it('registers an oidc-usermodel-realm-role-mapper emitting a top-level multivalued hrobot_roles claim in the access token', async () => {
    await step.execute(job)

    const clientCalls = callsTo((url, init) => init.method === 'POST' && /\/clients$/.test(url))
    expect(clientCalls).toHaveLength(1)
    const clientBody = JSON.parse(clientCalls[0]![1].body ?? '{}') as {
      protocolMappers?: Array<{ protocolMapper: string; config: Record<string, string> }>
    }
    const mapper = clientBody.protocolMappers?.find((m) => m.protocolMapper === 'oidc-usermodel-realm-role-mapper')

    expect(mapper).toBeDefined()
    expect(mapper!.config['claim.name']).toBe('hrobot_roles')
    expect(mapper!.config['multivalued']).toBe('true')
    expect(mapper!.config['access.token.claim']).toBe('true')
  })

  it('fetches the ADMIN_KLIENTA role representation and assigns it to the initial user', async () => {
    await step.execute(job)

    // fetched the role first to obtain its id
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/realms/hrobot-acme/roles/ADMIN_KLIENTA'),
      expect.objectContaining({ method: 'GET' }),
    )

    // posted the realm role mapping for the created user
    const assignCalls = callsTo((url, init) => init.method === 'POST' && /\/users\/user-uuid-1\/role-mappings\/realm$/.test(url))
    expect(assignCalls).toHaveLength(1)
    const assigned = JSON.parse(assignCalls[0]![1].body ?? '[]') as Array<{ id: string; name: string }>
    expect(assigned).toEqual([{ id: 'role-uuid-admin', name: 'ADMIN_KLIENTA' }])
  })

  it('tolerates a 409 when a role already exists (idempotent retry) and still advances to DONE', async () => {
    mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
      if (init.method === 'POST' && /\/realms\/hrobot-acme\/roles$/.test(url)) return res({ status: 409 })
      return happyPathFetch(url, init)
    })

    await expect(step.execute(job)).resolves.toBeUndefined()
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.DONE },
    })
  })

  it('throws on a non-409 Keycloak error and does not advance the job', async () => {
    mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
      if (init.method === 'POST' && /\/realms$/.test(url)) return res({ status: 500 })
      return happyPathFetch(url, init)
    })

    await expect(step.execute(job)).rejects.toThrow()
    expect(mockPrisma.provisioningJob.update).not.toHaveBeenCalled()
  })

  it('resolves the user by email when the create response carries no Location (retry)', async () => {
    mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
      if (init.method === 'POST' && /\/users$/.test(url)) return res({ status: 409 })
      return happyPathFetch(url, init)
    })

    await step.execute(job)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/users?email=admin%40acme.com'),
      expect.objectContaining({ method: 'GET' }),
    )
    const assignCalls = callsTo((url, init) => init.method === 'POST' && /\/users\/user-uuid-1\/role-mappings\/realm$/.test(url))
    expect(assignCalls).toHaveLength(1)
  })

  it('throws KeycloakNotReadyError when the token endpoint returns 401 (KC still initializing)', async () => {
    mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
      if (url.includes('/protocol/openid-connect/token'))
        return res({ status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } })
      return happyPathFetch(url, init)
    })

    await expect(step.execute(job)).rejects.toBeInstanceOf(KeycloakNotReadyError)
    expect(mockPrisma.provisioningJob.update).not.toHaveBeenCalled()
  })

  it('throws KeycloakNotReadyError when the token endpoint returns 503', async () => {
    mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
      if (url.includes('/protocol/openid-connect/token'))
        return res({ status: 503 })
      return happyPathFetch(url, init)
    })

    await expect(step.execute(job)).rejects.toBeInstanceOf(KeycloakNotReadyError)
  })

  it('throws a plain Error (not KeycloakNotReadyError) on unexpected token endpoint status', async () => {
    mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
      if (url.includes('/protocol/openid-connect/token'))
        return res({ status: 400 })
      return happyPathFetch(url, init)
    })

    await expect(step.execute(job)).rejects.toThrow(/400/)
    await expect(step.execute(job)).rejects.not.toBeInstanceOf(KeycloakNotReadyError)
  })

  it('stores realmName in tenants.metadata and advances to DONE', async () => {
    await step.execute(job)

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ realmName: 'hrobot-acme' }) as object,
        }) as object,
      }),
    )
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.DONE },
    })
  })
})
