import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { GrafikController } from './grafik.controller.js'
import { GrafikService } from './grafik.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  solveGrafik: jest.fn(),
  listShifts: jest.fn(),
  getShift: jest.fn(),
  createShift: jest.fn(),
  updateShift: jest.fn(),
  deleteShift: jest.fn(),
  listDemands: jest.fn(),
  getDemand: jest.fn(),
  createDemand: jest.fn(),
  updateDemand: jest.fn(),
  deleteDemand: jest.fn(),
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  deleteTemplate: jest.fn(),
  listLokalizacje: jest.fn(),
  listUnits: jest.fn(),
}
const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.HR], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('GrafikController', () => {
  let controller: GrafikController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrafikController],
      providers: [{ provide: GrafikService, useValue: mockService }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(GrafikController)
    jest.clearAllMocks()
  })

  it('delegates createShift with an actor projected from the JWT + IP', async () => {
    mockService.createShift.mockResolvedValue({ id: 'shift-1' })
    const dto = { employeeId: 'e', lokalizacjaId: 'l', date: '2026-07-13', start: '08:00', end: '16:00', role: 'NURSE' }

    const result = await controller.createShift(client, user, '1.2.3.4', dto)

    expect(result).toEqual({ id: 'shift-1' })
    expect(mockService.createShift).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      dto,
    )
  })

  it('delegates solve with an actor projected from the JWT + IP', async () => {
    mockService.solveGrafik.mockResolvedValue({ status: 'OPTIMAL', assignmentsCreated: 2, unmet: [], metrics: {}, shifts: [] })
    const dto = { weekStart: '2026-07-13', unitId: '11111111-1111-1111-1111-111111111111' }

    const result = await controller.solve(client, user, '1.2.3.4', dto)

    expect(result).toEqual({ status: 'OPTIMAL', assignmentsCreated: 2, unmet: [], metrics: {}, shifts: [] })
    expect(mockService.solveGrafik).toHaveBeenCalledWith(client, { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' }, dto)
  })

  it('delegates listShifts and returns the service result', async () => {
    mockService.listShifts.mockResolvedValue([{ id: 'shift-1' }])
    expect(await controller.listShifts(client, user, '1.2.3.4')).toEqual([{ id: 'shift-1' }])
    expect(mockService.listShifts).toHaveBeenCalledWith(client, expect.objectContaining({ userId: 'kc-1' }))
  })

  it('delegates deleteTemplate', async () => {
    mockService.deleteTemplate.mockResolvedValue({ id: 'tpl-1' })
    expect(await controller.deleteTemplate(client, user, '1.2.3.4', 'tpl-1')).toEqual({ id: 'tpl-1' })
    expect(mockService.deleteTemplate).toHaveBeenCalledWith(client, expect.any(Object), 'tpl-1')
  })

  // --- RBAC metadata: proves the role gate wired to each route -----------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof GrafikController): string[] =>
      reflector.get<string[]>(ROLES_KEY, GrafikController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it('allows MANAGER on shift mutations (unit-scoped in the service)', () => {
      expect(rolesFor('createShift')).toContain(Role.MANAGER)
      expect(rolesFor('updateShift')).toContain(Role.MANAGER)
      expect(rolesFor('deleteShift')).toContain(Role.MANAGER)
    })

    it('allows MANAGER/HR/ADMIN on solve (unit-scoped in the service)', () => {
      expect(rolesFor('solve')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts demand/template mutations to HR/ADMIN — MANAGER excluded', () => {
      for (const m of ['createDemand', 'updateDemand', 'deleteDemand', 'createTemplate', 'updateTemplate', 'deleteTemplate'] as const) {
        const roles = rolesFor(m)
        expect(roles).toEqual([Role.HR, Role.ADMIN_KLIENTA])
        expect(roles).not.toContain(Role.MANAGER)
      }
    })

    it('allows every scheduling role — including PRACOWNIK — to read (shifts own-scoped in the service)', () => {
      for (const m of ['listShifts', 'getShift', 'listDemands', 'listTemplates'] as const) {
        expect(rolesFor(m)).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
      }
    })

    it('exposes catalog name lookups to every scheduling role including PRACOWNIK', () => {
      for (const m of ['listLokalizacje', 'listUnits'] as const) {
        expect(rolesFor(m)).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK])
      }
    })
  })
})
