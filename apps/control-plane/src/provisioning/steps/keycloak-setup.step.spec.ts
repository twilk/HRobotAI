import { Test, TestingModule } from '@nestjs/testing'
import {
  BOOTSTRAP_ISSUED_AT_KEY,
  BOOTSTRAP_PASSWORD_KEY,
  KeycloakSetupStep,
  bootstrapAad,
} from './keycloak-setup.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService, ProvisioningStep, Role } from '@hrobot/shared'

const encryption = new EncryptionService(Buffer.from('a'.repeat(64), 'hex'))

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
      providers: [
        KeycloakSetupStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'FETCH', useValue: mockFetch },
        { provide: EncryptionService, useValue: encryption },
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

  /**
   * G-2: without SMTP the reset e-mail cannot go out, and the temp password used to be thrown
   * away — leaving a fully provisioned tenant whose admin account nobody could log into. These
   * specs pin the fallback AND its safety envelope (encrypted, tenant-bound, never logged, only
   * stored when it is actually the account's live credential).
   */
  describe('G-2: bootstrap credential when no reset e-mail can be delivered', () => {
    /** Same happy path, but Keycloak has no SMTP configured → execute-actions-email 500s. */
    const noSmtpFetch = (url: string, init: FetchInit = {}) =>
      init.method === 'PUT' && url.includes('/execute-actions-email')
        ? res({ status: 500 })
        : happyPathFetch(url, init)

    const metadataWritten = (): Record<string, unknown> =>
      (mockPrisma.tenant.update.mock.calls[0]?.[0] as { data: { metadata: Record<string, unknown> } })
        .data.metadata

    it('persists the temp password ENCRYPTED and tenant-bound when the e-mail fails', async () => {
      mockFetch.mockImplementation(noSmtpFetch)

      await step.execute(job)

      const meta = metadataWritten()
      const blob = meta[BOOTSTRAP_PASSWORD_KEY]
      expect(typeof blob).toBe('string')
      // Ciphertext at rest — the plaintext password must never sit in the metadata column.
      const password = encryption.decrypt(blob as string, bootstrapAad('tenant-1'))
      expect(password).toMatch(/^[A-Za-z0-9_-]{10,}$/)
      // …and it is the credential actually installed on the Keycloak account.
      const createUserCall = callsTo((url, init) => init.method === 'POST' && /\/users$/.test(url))[0]!
      const sent = JSON.parse(createUserCall[1].body ?? '{}') as {
        credentials: Array<{ value: string; temporary: boolean }>
      }
      expect(sent.credentials[0]!.value).toBe(password)
      // Single-use by construction: Keycloak forces a change on first login.
      expect(sent.credentials[0]!.temporary).toBe(true)
      expect(typeof meta[BOOTSTRAP_ISSUED_AT_KEY]).toBe('string')
    })

    it('binds the ciphertext to its tenant — it will not decrypt under another tenant id', async () => {
      mockFetch.mockImplementation(noSmtpFetch)

      await step.execute(job)

      const blob = metadataWritten()[BOOTSTRAP_PASSWORD_KEY] as string
      expect(() => encryption.decrypt(blob, bootstrapAad('some-other-tenant'))).toThrow()
    })

    it('stores NOTHING when the reset e-mail was delivered normally', async () => {
      await step.execute(job) // happyPathFetch → execute-actions-email 201

      expect(metadataWritten()).not.toHaveProperty(BOOTSTRAP_PASSWORD_KEY)
    })

    it('wipes a previously stored credential once an e-mail finally goes through', async () => {
      mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({
        ...tenant,
        metadata: {
          adminEmail: 'admin@acme.com',
          [BOOTSTRAP_PASSWORD_KEY]: 'stale-blob',
          [BOOTSTRAP_ISSUED_AT_KEY]: '2026-01-01T00:00:00.000Z',
        },
      })

      await step.execute(job) // happy path → e-mail delivered

      const meta = metadataWritten()
      expect(meta).not.toHaveProperty(BOOTSTRAP_PASSWORD_KEY)
      expect(meta).not.toHaveProperty(BOOTSTRAP_ISSUED_AT_KEY)
    })

    it('does NOT store a password on a 409 retry — Keycloak ignored the credential, so it would not work', async () => {
      mockFetch.mockImplementation((url: string, init: FetchInit = {}) => {
        if (init.method === 'POST' && /\/users$/.test(url)) return res({ status: 409 })
        return noSmtpFetch(url, init)
      })

      await step.execute(job)

      expect(metadataWritten()).not.toHaveProperty(BOOTSTRAP_PASSWORD_KEY)
    })
  })
})
