import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AnalitykController } from './analityk.controller.js'
import { AnalitykService } from './analityk.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  resolveScope: jest.fn(),
  podsumowanie: jest.fn(),
  zatrudnienie: jest.fn(),
  absencje: jest.fn(),
  czasPracy: jest.fn(),
  urlopy: jest.fn(),
  wnioski: jest.fn(),
  porownanie: jest.fn(),
  anomalie: jest.fn(),
}
const client = {} as TenantClient
const hr: JwtPayload = { sub: 'kc-hr', iss: 'x', hrobot_roles: [Role.HR], exp: 0 }
const manager: JwtPayload = { sub: 'kc-mgr', iss: 'x', hrobot_roles: [Role.MANAGER], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

const QUERY = { od: '2026-06-01', do: '2026-06-14' }

/** Every read route, paired with the service method it must delegate to. */
const ROUTES = [
  ['podsumowanie', 'podsumowanie'],
  ['zatrudnienie', 'zatrudnienie'],
  ['absencje', 'absencje'],
  ['czasPracy', 'czasPracy'],
  ['urlopy', 'urlopy'],
  ['wnioski', 'wnioski'],
  ['porownanie', 'porownanie'],
  ['anomalie', 'anomalie'],
] as const

describe('AnalitykController', () => {
  let controller: AnalitykController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalitykController],
      providers: [{ provide: AnalitykService, useValue: mockService }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(AnalitykController)
    jest.clearAllMocks()
    mockService.resolveScope.mockResolvedValue(null)
  })

  describe('delegation', () => {
    it.each(ROUTES)('delegates %s to AnalitykService.%s with the parsed range and resolved scope', async (route, method) => {
      mockService[method].mockResolvedValue({ ok: true })

      const result = await controller[route](client, hr, '1.2.3.4', { ...QUERY })

      expect(result).toEqual({ ok: true })
      expect(mockService[method]).toHaveBeenCalledTimes(1)
      const [passedClient, passedScope, passedRange] = mockService[method].mock.calls[0]
      expect(passedClient).toBe(client)
      expect(passedScope).toBeNull()
      expect(passedRange.from.toISOString()).toBe('2026-06-01T00:00:00.000Z')
      expect(passedRange.toIncl.toISOString()).toBe('2026-06-14T00:00:00.000Z')
      expect(passedRange.toExcl.toISOString()).toBe('2026-06-15T00:00:00.000Z')
    })

    it('builds the actor from the JWT subject, roles and request IP', async () => {
      mockService.podsumowanie.mockResolvedValue({})
      await controller.podsumowanie(client, manager, '10.1.2.3', { ...QUERY })
      expect(mockService.resolveScope).toHaveBeenCalledWith(
        client,
        { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.1.2.3' },
        undefined,
      )
    })

    it('passes an explicit unitId through to the scope resolver for intersection', async () => {
      mockService.zatrudnienie.mockResolvedValue({})
      await controller.zatrudnienie(client, manager, '1.2.3.4', { ...QUERY, unitId: 'unit-A' })
      expect(mockService.resolveScope).toHaveBeenCalledWith(client, expect.anything(), 'unit-A')
    })

    it('forwards the scope the service resolved, so a MANAGER only ever aggregates their own units', async () => {
      mockService.resolveScope.mockResolvedValue(['unit-A'])
      mockService.absencje.mockResolvedValue({})
      await controller.absencje(client, manager, '1.2.3.4', { ...QUERY })
      expect(mockService.absencje.mock.calls[0][1]).toEqual(['unit-A'])
    })

    it('propagates a scope 403 and never runs the aggregation', async () => {
      mockService.resolveScope.mockRejectedValue(new ForbiddenException('Jednostka jest poza Twoim zakresem'))
      await expect(controller.wnioski(client, manager, '1.2.3.4', { ...QUERY, unitId: 'unit-Z' })).rejects.toThrow(ForbiddenException)
      expect(mockService.wnioski).not.toHaveBeenCalled()
    })
  })

  describe('range validation', () => {
    it('rejects an inverted range with a 400 before resolving scope or querying', async () => {
      await expect(controller.podsumowanie(client, hr, '1.2.3.4', { od: '2026-06-14', do: '2026-06-01' })).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.resolveScope).not.toHaveBeenCalled()
      expect(mockService.podsumowanie).not.toHaveBeenCalled()
    })

    it('rejects a date that is well-formed but not a real calendar day', async () => {
      await expect(controller.absencje(client, hr, '1.2.3.4', { od: '2026-02-30', do: '2026-03-05' })).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // --- RBAC ---------------------------------------------------------------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof AnalitykController): string[] =>
      reflector.get<string[]>(ROLES_KEY, AnalitykController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it.each(ROUTES.map(([route]) => route))('restricts %s to HR/ADMIN_KLIENTA/MANAGER', (route) => {
      expect(rolesFor(route)).toEqual([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])
    })

    it.each(ROUTES.map(([route]) => route))('EXCLUDES PRACOWNIK from %s — analytics is not self-service', (route) => {
      expect(rolesFor(route)).not.toContain(Role.PRACOWNIK)
    })
  })

  describe('RbacGuard (the real guard, against the real route metadata)', () => {
    const guard = new RbacGuard(new Reflector())

    /** A minimal ExecutionContext pointing at one real controller method with the given caller roles. */
    const ctxFor = (method: keyof AnalitykController, roles: string[]): ExecutionContext =>
      ({
        getHandler: () => AnalitykController.prototype[method],
        getClass: () => AnalitykController,
        switchToHttp: () => ({ getRequest: () => ({ user: { hrobot_roles: roles } }) }),
      }) as unknown as ExecutionContext

    it.each(ROUTES.map(([route]) => route))('rejects a PRACOWNIK calling %s with a 403', (route) => {
      expect(() => guard.canActivate(ctxFor(route, [Role.PRACOWNIK]))).toThrow(ForbiddenException)
    })

    it.each(ROUTES.map(([route]) => route))('rejects a caller with NO roles calling %s', (route) => {
      expect(() => guard.canActivate(ctxFor(route, []))).toThrow(ForbiddenException)
    })

    it.each([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])('admits a %s', (role) => {
      expect(guard.canActivate(ctxFor('podsumowanie', [role]))).toBe(true)
    })
  })
})
