import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { UstawieniaController } from './ustawienia.controller.js'
import { SettingsService } from './ustawienia.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  getCompany: jest.fn(),
  upsertCompany: jest.fn(),
  listUnits: jest.fn(),
  createUnit: jest.fn(),
  updateUnit: jest.fn(),
}
const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.ADMIN_KLIENTA], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('UstawieniaController', () => {
  let controller: UstawieniaController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UstawieniaController],
      providers: [{ provide: SettingsService, useValue: mockService }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(UstawieniaController)
    jest.clearAllMocks()
  })

  it('delegates getCompany to SettingsService.getCompany with an actor', async () => {
    mockService.getCompany.mockResolvedValue({ companyName: 'Acme' })

    const result = await controller.getCompany(client, user, '1.2.3.4')

    expect(result).toEqual({ companyName: 'Acme' })
    expect(mockService.getCompany).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.ADMIN_KLIENTA], ipAddress: '1.2.3.4' })
  })

  it('delegates updateCompany to SettingsService.upsertCompany with the actor and dto', async () => {
    mockService.upsertCompany.mockResolvedValue({ id: 'cs1' })

    const dto = { companyName: 'New' }
    const result = await controller.updateCompany(client, user, '1.2.3.4', dto)

    expect(result).toEqual({ id: 'cs1' })
    expect(mockService.upsertCompany).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.ADMIN_KLIENTA], ipAddress: '1.2.3.4' }, dto)
  })

  it('delegates listUnits to SettingsService.listUnits with an actor', async () => {
    mockService.listUnits.mockResolvedValue([{ id: 'u1' }])

    const result = await controller.listUnits(client, user, '1.2.3.4')

    expect(result).toEqual([{ id: 'u1' }])
    expect(mockService.listUnits).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.ADMIN_KLIENTA], ipAddress: '1.2.3.4' })
  })

  it('delegates createUnit to SettingsService.createUnit with the actor and dto', async () => {
    mockService.createUnit.mockResolvedValue({ id: 'u1' })

    const dto = { name: 'Unit' }
    const result = await controller.createUnit(client, user, '1.2.3.4', dto)

    expect(result).toEqual({ id: 'u1' })
    expect(mockService.createUnit).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.ADMIN_KLIENTA], ipAddress: '1.2.3.4' }, dto)
  })

  it('delegates updateUnit to SettingsService.updateUnit with the id, actor and dto', async () => {
    mockService.updateUnit.mockResolvedValue({ id: 'u1', name: 'New' })

    const dto = { name: 'New' }
    const result = await controller.updateUnit(client, user, '1.2.3.4', 'u1', dto)

    expect(result).toEqual({ id: 'u1', name: 'New' })
    expect(mockService.updateUnit).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.ADMIN_KLIENTA], ipAddress: '1.2.3.4' }, 'u1', dto)
  })

  // --- RBAC metadata: proves the role gate wired to each route ------------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof UstawieniaController): string[] =>
      reflector.get<string[]>(ROLES_KEY, UstawieniaController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it('opens getCompany to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('getCompany')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts updateCompany to ADMIN_KLIENTA', () => {
      expect(rolesFor('updateCompany')).toEqual([Role.ADMIN_KLIENTA])
    })

    it('opens listUnits to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('listUnits')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts createUnit to ADMIN_KLIENTA', () => {
      expect(rolesFor('createUnit')).toEqual([Role.ADMIN_KLIENTA])
    })

    it('restricts updateUnit to ADMIN_KLIENTA', () => {
      expect(rolesFor('updateUnit')).toEqual([Role.ADMIN_KLIENTA])
    })
  })
})
