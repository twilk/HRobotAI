import { Test, TestingModule } from '@nestjs/testing'
import { KeycloakSetupStep } from './keycloak-setup.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { ProvisioningStep } from '@hrobot/shared'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

// Tracks fetch calls in order
let callIndex: number

const mockFetch = jest.fn()

const job = { id: 'job-1', tenantId: 'tenant-1', step: ProvisioningStep.KEYCLOAK_SETUP, attemptCount: 0 }
const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  metadata: { adminEmail: 'admin@acme.com' },
}

describe('KeycloakSetupStep', () => {
  let step: KeycloakSetupStep

  beforeEach(async () => {
    callIndex = 0
    mockFetch.mockImplementation((_url: string, _opts: { method: string }) => {
      callIndex++
      // 1: token, 2: create realm, 3: create client, 4: create user, 5: send email
      if (callIndex === 1) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'tok' }) })
      if (callIndex === 4) return Promise.resolve({
        ok: true,
        headers: { get: (_name: string) => 'http://kc/admin/realms/hrobot-acme/users/user-uuid-1' },
        json: async () => ({}),
      })
      return Promise.resolve({ ok: true, headers: { get: () => null }, json: async () => ({}) })
    })

    // Set env vars required by parseEnv() in KeycloakSetupStep
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
      ],
    }).compile()
    step = module.get(KeycloakSetupStep)
    jest.clearAllMocks()
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue(tenant)
    mockPrisma.tenant.update.mockResolvedValue({})
    mockPrisma.provisioningJob.update.mockResolvedValue({})
    callIndex = 0
    mockFetch.mockImplementation((_url: string, _opts: RequestInit) => {
      callIndex++
      if (callIndex === 1) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'tok' }) })
      if (callIndex === 4) return Promise.resolve({
        ok: true,
        headers: { get: () => 'http://kc/admin/realms/hrobot-acme/users/user-uuid-1' },
        json: async () => ({}),
      })
      return Promise.resolve({ ok: true, headers: { get: () => null }, json: async () => ({}) })
    })
  })

  it('makes 5 fetch calls: token + realm + client + user + credential email', async () => {
    await step.execute(job)
    expect(mockFetch).toHaveBeenCalledTimes(5)
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
