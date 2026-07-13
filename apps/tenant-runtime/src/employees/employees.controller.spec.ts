import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
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
  me: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
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

  it('delegates findMe to EmployeesService.me with an actor projected from the JWT + IP', async () => {
    mockService.me.mockResolvedValue({ id: 'emp-self' })

    const result = await controller.findMe(client, user, '1.2.3.4')

    expect(result).toEqual({ id: 'emp-self' })
    expect(mockService.me).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' })
  })

  it('delegates update to EmployeesService.update with the actor, id, dto and tenantId', async () => {
    mockService.update.mockResolvedValue({ id: 'emp-1', position: 'new' })

    const dto = { position: 'new' }
    const result = await controller.update(client, user, '1.2.3.4', 'tenant-1', 'emp-1', dto)

    expect(result).toEqual({ id: 'emp-1', position: 'new' })
    expect(mockService.update).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'emp-1',
      dto,
      'tenant-1',
    )
  })

  it('delegates create to EmployeesService.create with the actor, dto and tenantId', async () => {
    mockService.create.mockResolvedValue({ id: 'emp-new' })

    const dto = {
      firstName: 'Anna',
      lastName: 'Kowalska',
      position: 'Kasjer',
      employmentType: 'UMOWA_O_PRACE',
      unitId: '550e8400-e29b-41d4-a716-446655440000',
      pesel: '44051401359',
      hiredAt: '2024-01-15',
    }
    const result = await controller.create(client, user, '1.2.3.4', 'tenant-1', dto as never)

    expect(result).toEqual({ id: 'emp-new' })
    expect(mockService.create).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      dto,
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

    it('allows every scheduling role to read their own profile via /me (scoped in the service)', () => {
      expect(rolesFor('findMe')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
    })

    it('allows every scheduling role to read a single profile (scoped in the service)', () => {
      expect(rolesFor('findOne')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
    })

    it('restricts update (PATCH) to HR/ADMIN_KLIENTA only', () => {
      expect(rolesFor('update')).toEqual([Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts create (POST) to HR/ADMIN_KLIENTA only', () => {
      expect(rolesFor('create')).toEqual([Role.HR, Role.ADMIN_KLIENTA])
    })
  })

  // --- Route ordering: literal `me` must beat the `:id` param route -------------------------------

  describe('GET route ordering', () => {
    const proto = EmployeesController.prototype
    const pathFor = (method: keyof EmployeesController): string =>
      Reflect.getMetadata(PATH_METADATA, proto[method] as (...args: unknown[]) => unknown) as string

    it('binds findMe to the literal `me` path and findOne to the `:id` param path', () => {
      expect(pathFor('findMe')).toBe('me')
      expect(pathFor('findOne')).toBe(':id')
    })

    it('declares the `me` route BEFORE the `:id` route (Nest matches by declaration order)', () => {
      const names = Object.getOwnPropertyNames(proto)
      expect(names.indexOf('findMe')).toBeGreaterThanOrEqual(0)
      expect(names.indexOf('findMe')).toBeLessThan(names.indexOf('findOne'))
    })
  })
})
