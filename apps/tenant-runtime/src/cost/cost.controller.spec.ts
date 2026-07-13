import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, BadRequestException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { EmploymentType, Role } from '@hrobot/shared'
import { CostController } from './cost.controller.js'
import { CostService } from './cost.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockCost = {
  getRates: jest.fn(),
  upsertRate: jest.fn(),
  budgetStatus: jest.fn(),
}
const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.HR], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('CostController', () => {
  let controller: CostController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CostController],
      providers: [{ provide: CostService, useValue: mockCost }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(CostController)
    jest.clearAllMocks()
  })

  it('delegates getRates to CostService.getRates', async () => {
    mockCost.getRates.mockResolvedValue([{ id: 'rate-1' }])

    const result = await controller.getRates(client)

    expect(result).toEqual([{ id: 'rate-1' }])
    expect(mockCost.getRates).toHaveBeenCalledWith(client)
  })

  it('delegates upsertRate to CostService.upsertRate with the actor and dto', async () => {
    mockCost.upsertRate.mockResolvedValue({ id: 'rate-1' })

    const dto = { position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE, hourlyRate: 30 }
    const result = await controller.upsertRate(client, user, '1.2.3.4', dto)

    expect(result).toEqual({ id: 'rate-1' })
    expect(mockCost.upsertRate).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      dto,
    )
  })

  it('delegates week to CostService.budgetStatus with a parsed weekStart Date and optional unitId', async () => {
    mockCost.budgetStatus.mockResolvedValue({ cost: '100.00', cap: null, overBudget: false })

    const result = await controller.week(client, user, '1.2.3.4', '2026-07-13', 'unit-A')

    expect(result).toEqual({ cost: '100.00', cap: null, overBudget: false })
    expect(mockCost.budgetStatus).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'unit-A',
      new Date('2026-07-13'),
    )
  })

  it('week allows an absent unitId (global HR/ADMIN view)', async () => {
    mockCost.budgetStatus.mockResolvedValue({ cost: '0.00' })

    await controller.week(client, user, '1.2.3.4', '2026-07-13', undefined)

    expect(mockCost.budgetStatus).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      undefined,
      new Date('2026-07-13'),
    )
  })

  it('week rejects a missing weekStart with a BadRequestException, never reaching the service', async () => {
    await expect(controller.week(client, user, '1.2.3.4', '', undefined)).rejects.toThrow(BadRequestException)
    expect(mockCost.budgetStatus).not.toHaveBeenCalled()
  })

  it('week rejects a garbage weekStart with a BadRequestException, never reaching the service', async () => {
    await expect(controller.week(client, user, '1.2.3.4', 'not-a-date', undefined)).rejects.toThrow(
      'weekStart must be a valid ISO date',
    )
    expect(mockCost.budgetStatus).not.toHaveBeenCalled()
  })

  // --- RBAC metadata: proves the role gate wired to each route ------------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof CostController): string[] =>
      reflector.get<string[]>(ROLES_KEY, CostController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it('opens getRates to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('getRates')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts upsertRate to HR/ADMIN_KLIENTA only (Codex P1-1 — never MANAGER)', () => {
      expect(rolesFor('upsertRate')).toEqual([Role.HR, Role.ADMIN_KLIENTA])
    })

    it('opens week to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('week')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })
  })
})
