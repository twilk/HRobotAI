import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { EmployeesController } from './employees.controller.js'
import { EmployeesService } from './employees.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  list: jest.fn(),
  getById: jest.fn(),
}
const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.HR], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('EmployeesController', () => {
  let controller: EmployeesController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeesController],
      providers: [{ provide: EmployeesService, useValue: mockService }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(EmployeesController)
    jest.clearAllMocks()
  })

  it('delegates findAll to EmployeesService.list with an actor projected from the JWT + IP', async () => {
    mockService.list.mockResolvedValue([{ id: 'emp-1' }])

    const result = await controller.findAll(client, user, '1.2.3.4')

    expect(result).toEqual([{ id: 'emp-1' }])
    expect(mockService.list).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' })
  })

  it('returns empty array when the service resolves no employees', async () => {
    mockService.list.mockResolvedValue([])
    expect(await controller.findAll(client, user, '1.2.3.4')).toEqual([])
  })

  it('delegates findOne to EmployeesService.getById with the actor, id and tenantId', async () => {
    mockService.getById.mockResolvedValue({ id: 'emp-1' })

    const result = await controller.findOne(client, user, '1.2.3.4', 'tenant-1', 'emp-1')

    expect(result).toEqual({ id: 'emp-1' })
    expect(mockService.getById).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'emp-1',
      'tenant-1',
    )
  })

  // --- RBAC metadata: proves the role gate wired to the route ------------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof EmployeesController): string[] =>
      reflector.get<string[]>(ROLES_KEY, EmployeesController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it('allows every scheduling role to read the roster (scoped in the service)', () => {
      expect(rolesFor('findAll')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
    })

    it('allows every scheduling role to read a single profile (scoped in the service)', () => {
      expect(rolesFor('findOne')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
    })
  })
})
