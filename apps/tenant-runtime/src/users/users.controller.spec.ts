import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  list: jest.fn(),
  invite: jest.fn(),
  assignRole: jest.fn(),
  revokeRole: jest.fn(),
  deactivate: jest.fn(),
  reconcile: jest.fn(),
}
const client = {} as TenantClient
const ISS = 'http://localhost:8080/realms/hrobot-acme'
const user: JwtPayload = { sub: 'kc-admin', iss: ISS, hrobot_roles: [Role.ADMIN_KLIENTA], exp: 0 }
const EXPECTED_ACTOR = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '1.2.3.4' }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('UsersController', () => {
  let controller: UsersController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockService }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(UsersController)
    jest.clearAllMocks()
  })

  it('delegates list to UsersService.list', async () => {
    mockService.list.mockResolvedValue([{ id: 'user-1' }])
    expect(await controller.list(client)).toEqual([{ id: 'user-1' }])
    expect(mockService.list).toHaveBeenCalledWith(client)
  })

  it('delegates invite to UsersService.invite with the actor, realm (from JWT iss), email, role and unitId', async () => {
    mockService.invite.mockResolvedValue({ id: 'user-new' })

    const result = await controller.invite(client, user, '1.2.3.4', { email: 'new@acme.com', role: Role.HR, unitId: undefined })

    expect(result).toEqual({ id: 'user-new' })
    expect(mockService.invite).toHaveBeenCalledWith(client, EXPECTED_ACTOR, 'hrobot-acme', 'new@acme.com', Role.HR, null)
  })

  it('passes a provided unitId through to invite (not coerced to null)', async () => {
    mockService.invite.mockResolvedValue({ id: 'user-new' })
    await controller.invite(client, user, '1.2.3.4', { email: 'new@acme.com', role: Role.MANAGER, unitId: 'unit-1' })
    expect(mockService.invite).toHaveBeenCalledWith(client, EXPECTED_ACTOR, 'hrobot-acme', 'new@acme.com', Role.MANAGER, 'unit-1')
  })

  it('delegates assignRole to UsersService.assignRole with the actor, realm, target userId, role and unitId', async () => {
    await controller.assignRole(client, user, '1.2.3.4', 'user-target', { role: Role.MANAGER, unitId: undefined })
    expect(mockService.assignRole).toHaveBeenCalledWith(client, EXPECTED_ACTOR, 'hrobot-acme', 'user-target', Role.MANAGER, null)
  })

  it('delegates revokeRole to UsersService.revokeRole with the actor, realm, target userId, role and unitId', async () => {
    await controller.revokeRole(client, user, '1.2.3.4', 'user-target', { role: Role.MANAGER, unitId: 'unit-1' })
    expect(mockService.revokeRole).toHaveBeenCalledWith(client, EXPECTED_ACTOR, 'hrobot-acme', 'user-target', Role.MANAGER, 'unit-1')
  })

  it('delegates deactivate to UsersService.deactivate with the actor, realm and target userId', async () => {
    await controller.deactivate(client, user, '1.2.3.4', 'user-target')
    expect(mockService.deactivate).toHaveBeenCalledWith(client, EXPECTED_ACTOR, 'hrobot-acme', 'user-target')
  })

  it('delegates reconcile to UsersService.reconcile, translating ?fix=true and passing ?userId through', async () => {
    mockService.reconcile.mockResolvedValue({ findings: [], fixedCount: 0 })
    const result = await controller.reconcile(client, user, '1.2.3.4', 'true', 'user-target')
    expect(result).toEqual({ findings: [], fixedCount: 0 })
    expect(mockService.reconcile).toHaveBeenCalledWith(client, EXPECTED_ACTOR, 'hrobot-acme', { fix: true, userId: 'user-target' })
  })

  it('reconcile defaults fix to false when the query param is absent', async () => {
    mockService.reconcile.mockResolvedValue({ findings: [], fixedCount: 0 })
    await controller.reconcile(client, user, '1.2.3.4')
    expect(mockService.reconcile).toHaveBeenCalledWith(client, EXPECTED_ACTOR, 'hrobot-acme', { fix: false, userId: undefined })
  })

  it('throws 401 when the JWT iss cannot be resolved to a tenant realm', async () => {
    const badUser: JwtPayload = { sub: 'kc-admin', iss: 'http://evil.example.com/not-a-realm', hrobot_roles: [Role.ADMIN_KLIENTA], exp: 0 }
    await expect(controller.deactivate(client, badUser, '1.2.3.4', 'user-target')).rejects.toThrow(UnauthorizedException)
    expect(mockService.deactivate).not.toHaveBeenCalled()
  })

  // --- RBAC metadata: proves the class-level role gate covers every route -------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()

    it('restricts the whole controller to ADMIN_KLIENTA via @TenantRoute(Role.ADMIN_KLIENTA) (class-level)', () => {
      expect(reflector.get<string[]>(ROLES_KEY, UsersController)).toEqual([Role.ADMIN_KLIENTA])
    })

    it('does not need per-method @Roles — the class-level gate covers every handler', () => {
      for (const method of ['list', 'invite', 'assignRole', 'revokeRole', 'deactivate', 'reconcile'] as const) {
        expect(reflector.get<string[] | undefined>(ROLES_KEY, UsersController.prototype[method] as (...args: unknown[]) => unknown)).toBeUndefined()
      }
    })
  })
})
