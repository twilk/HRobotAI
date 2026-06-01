import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { of } from 'rxjs'
import { TenantContextInterceptor } from './tenant-context.interceptor.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { RedisService } from '../../common/redis/redis.service.js'
import { TenantPrismaManager } from '@hrobot/db'

const mockPrisma = { tenant: { findFirst: jest.fn() } }
const mockRedis = { client: { get: jest.fn(), setex: jest.fn() } }
const mockTenantClient = {}
const mockTenantManager = { getClient: jest.fn() }
const mockCounter = { inc: jest.fn() }

function makeCtx(iss: string): ExecutionContext {
  const request: Record<string, unknown> = {
    user: { iss, sub: 'user-1', hrobot_roles: ['ADMIN_KLIENTA'] },
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

async function run(interceptor: TenantContextInterceptor, ctx: ExecutionContext): Promise<{ error?: unknown }> {
  return new Promise((resolve) => {
    interceptor
      .intercept(ctx, { handle: () => of(null) } as never)
      .subscribe({ next: () => resolve({}), error: (e: unknown) => resolve({ error: e }) })
  })
}

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantContextInterceptor,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: TenantPrismaManager, useValue: mockTenantManager },
        { provide: 'REDIS_FALLBACK_COUNTER', useValue: mockCounter },
      ],
    }).compile()
    interceptor = module.get(TenantContextInterceptor)
    jest.clearAllMocks()
    mockTenantManager.getClient.mockResolvedValue(mockTenantClient)
  })

  it('resolves tenant from Redis and stamps tenantClient on request', async () => {
    const ctx = makeCtx('http://localhost:8080/realms/hrobot-acme')
    const req = ctx.switchToHttp().getRequest() as Record<string, unknown>
    mockRedis.client.get.mockResolvedValue(JSON.stringify({ id: 'tenant-1', status: 'ACTIVE' }))

    await run(interceptor, ctx)

    expect(req['tenantId']).toBe('tenant-1')
    expect(req['tenantClient']).toBe(mockTenantClient)
    expect(mockPrisma.tenant.findFirst).not.toHaveBeenCalled()
    expect(mockCounter.inc).not.toHaveBeenCalled()
  })

  it('falls back to Postgres when Redis throws and increments fallback counter', async () => {
    const ctx = makeCtx('http://localhost:8080/realms/hrobot-acme')
    const req = ctx.switchToHttp().getRequest() as Record<string, unknown>
    mockRedis.client.get.mockRejectedValue(new Error('ECONNREFUSED'))
    mockRedis.client.setex.mockRejectedValue(new Error('ECONNREFUSED'))
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' })

    await run(interceptor, ctx)

    expect(req['tenantId']).toBe('tenant-1')
    expect(mockCounter.inc).toHaveBeenCalledTimes(1)
  })

  it('throws ForbiddenException when tenant status is SUSPENDED', async () => {
    const ctx = makeCtx('http://localhost:8080/realms/hrobot-acme')
    mockRedis.client.get.mockResolvedValue(JSON.stringify({ id: 'tenant-1', status: 'SUSPENDED' }))

    const result = await run(interceptor, ctx)
    expect(result.error).toBeInstanceOf(ForbiddenException)
  })

  it('throws UnauthorizedException when tenant not found in DB', async () => {
    const ctx = makeCtx('http://localhost:8080/realms/hrobot-acme')
    mockRedis.client.get.mockResolvedValue(null)
    mockPrisma.tenant.findFirst.mockResolvedValue(null)

    const result = await run(interceptor, ctx)
    expect(result.error).toBeInstanceOf(UnauthorizedException)
  })
})
