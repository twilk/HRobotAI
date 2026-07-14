import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { LeaveController } from './leave.controller.js'
import { LeaveService } from './leave.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  createRequest: jest.fn(),
  list: jest.fn(),
  getById: jest.fn(),
  decide: jest.fn(),
  cancel: jest.fn(),
}
const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.MANAGER], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

const ANY_ROLE = [Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA]
const DECIDE_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA]

describe('LeaveController', () => {
  let controller: LeaveController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaveController],
      providers: [{ provide: LeaveService, useValue: mockService }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(LeaveController)
    jest.clearAllMocks()
  })

  it('delegates create to LeaveService.createRequest with an actor projected from the JWT + IP', async () => {
    mockService.createRequest.mockResolvedValue({ id: 'lv-1' })
    const dto = { startDate: '2026-08-01', endDate: '2026-08-05', type: 'URLOP_WYPOCZYNKOWY' }

    const result = await controller.create(client, user, '1.2.3.4', dto)

    expect(result).toEqual({ id: 'lv-1' })
    expect(mockService.createRequest).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' }, dto)
  })

  it('delegates list with the parsed mine/state/unitId filter', async () => {
    mockService.list.mockResolvedValue([])
    await controller.list(client, user, '1.2.3.4', 'true', 'PENDING', 'unit-A')
    expect(mockService.list).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' },
      { mine: true, state: 'PENDING', unitId: 'unit-A' },
    )
  })

  it('delegates getOne to LeaveService.getById', async () => {
    mockService.getById.mockResolvedValue({ id: 'lv-1' })
    const result = await controller.getOne(client, user, '1.2.3.4', 'lv-1')
    expect(result).toEqual({ id: 'lv-1' })
    expect(mockService.getById).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' }, 'lv-1')
  })

  it('delegates decide to LeaveService.decide with { approve, reason }', async () => {
    mockService.decide.mockResolvedValue({ id: 'lv-1', status: 'APPROVED' })
    const result = await controller.decide(client, user, '1.2.3.4', 'lv-1', { approve: true, reason: 'ok' })
    expect(result).toEqual({ id: 'lv-1', status: 'APPROVED' })
    expect(mockService.decide).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' },
      'lv-1',
      { approve: true, reason: 'ok' },
    )
  })

  it('delegates cancel to LeaveService.cancel', async () => {
    mockService.cancel.mockResolvedValue({ id: 'lv-1', status: 'CANCELLED' })
    const result = await controller.cancel(client, user, '1.2.3.4', 'lv-1')
    expect(result).toEqual({ id: 'lv-1', status: 'CANCELLED' })
    expect(mockService.cancel).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' }, 'lv-1')
  })

  // --- RBAC metadata: proves the role gate wired to each route -------------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof LeaveController): string[] =>
      reflector.get<string[]>(ROLES_KEY, LeaveController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it('allows any tenant role to create, list, read and cancel (scoped in the service)', () => {
      expect(rolesFor('create')).toEqual(ANY_ROLE)
      expect(rolesFor('list')).toEqual(ANY_ROLE)
      expect(rolesFor('getOne')).toEqual(ANY_ROLE)
      expect(rolesFor('cancel')).toEqual(ANY_ROLE)
    })

    it('restricts the decision route to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('decide')).toEqual(DECIDE_ROLES)
    })
  })
})
