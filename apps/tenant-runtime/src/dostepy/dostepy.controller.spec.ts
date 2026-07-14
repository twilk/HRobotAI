import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { AccessType, Role } from '@hrobot/shared'
import { DostepyController } from './dostepy.controller.js'
import { AccessService } from './dostepy.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  list: jest.fn(),
  issue: jest.fn(),
  revoke: jest.fn(),
  getById: jest.fn(),
}
const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.MANAGER], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

const ACCESS_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA]

describe('DostepyController', () => {
  let controller: DostepyController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DostepyController],
      providers: [{ provide: AccessService, useValue: mockService }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(DostepyController)
    jest.clearAllMocks()
  })

  it('delegates list with the parsed employeeId/status filter and an actor from the JWT + IP', async () => {
    mockService.list.mockResolvedValue([])
    await controller.list(client, user, '1.2.3.4', 'emp-x', 'ACTIVE')
    expect(mockService.list).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' },
      { employeeId: 'emp-x', status: 'ACTIVE' },
    )
  })

  it('delegates issue to AccessService.issue with the actor and dto', async () => {
    mockService.issue.mockResolvedValue({ id: 'ag-1' })
    const dto = { employeeId: 'emp-x', type: AccessType.CARD, label: 'Karta', identifier: 'C-1' }
    const result = await controller.issue(client, user, '1.2.3.4', dto)
    expect(result).toEqual({ id: 'ag-1' })
    expect(mockService.issue).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' }, dto)
  })

  it('delegates revoke to AccessService.revoke with { reason }', async () => {
    mockService.revoke.mockResolvedValue({ id: 'ag-1', status: 'REVOKED' })
    const result = await controller.revoke(client, user, '1.2.3.4', 'ag-1', { reason: 'zgubiona' })
    expect(result).toEqual({ id: 'ag-1', status: 'REVOKED' })
    expect(mockService.revoke).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' },
      'ag-1',
      { reason: 'zgubiona' },
    )
  })

  it('delegates getOne to AccessService.getById', async () => {
    mockService.getById.mockResolvedValue({ id: 'ag-1' })
    const result = await controller.getOne(client, user, '1.2.3.4', 'ag-1')
    expect(result).toEqual({ id: 'ag-1' })
    expect(mockService.getById).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.MANAGER], ipAddress: '1.2.3.4' }, 'ag-1')
  })

  // --- RBAC metadata: proves the role gate wired to each route -------------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof DostepyController): string[] =>
      reflector.get<string[]>(ROLES_KEY, DostepyController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it('restricts every route to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('list')).toEqual(ACCESS_ROLES)
      expect(rolesFor('issue')).toEqual(ACCESS_ROLES)
      expect(rolesFor('revoke')).toEqual(ACCESS_ROLES)
      expect(rolesFor('getOne')).toEqual(ACCESS_ROLES)
    })
  })
})
