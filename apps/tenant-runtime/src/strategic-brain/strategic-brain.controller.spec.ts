import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { StrategicBrainController } from './strategic-brain.controller.js'
import { SnapshotService } from './snapshot.service.js'
import { RecommendationService } from './recommendation.service.js'
import { PerformanceConfigService } from './performance-config.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const snapshots = {
  overview: jest.fn(),
  employeeCard: jest.fn(),
  employeeCardByKeycloakSub: jest.fn(),
}
const recommendations = {
  listRecruitment: jest.fn(),
  acknowledge: jest.fn(),
}
const config = {
  getEffectiveConfig: jest.fn(),
  upsertConfig: jest.fn(),
}
const audit = { log: jest.fn() }

/** A mock tenant client that exposes only what the SCOPE resolution (`managedUnitIds`) touches — the
 * `userRole.findMany` delegate. HR/ADMIN callers are global and must NEVER reach it. */
function makeClient() {
  return { userRole: { findMany: jest.fn().mockResolvedValue([]) } }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const IP = '1.2.3.4'
const user = (roles: string[], sub = 'kc-1'): JwtPayload => ({ sub, iss: 'x', hrobot_roles: roles, exp: 0 })

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('StrategicBrainController', () => {
  let controller: StrategicBrainController
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategicBrainController],
      providers: [
        { provide: SnapshotService, useValue: snapshots },
        { provide: RecommendationService, useValue: recommendations },
        { provide: PerformanceConfigService, useValue: config },
        { provide: AuditService, useValue: audit },
      ],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(StrategicBrainController)
    client = makeClient()
    jest.clearAllMocks()
  })

  // --- M17: route ordering — literal `employee/me` must beat the `employee/:id` param route -------
  describe('GET route ordering (M17)', () => {
    const proto = StrategicBrainController.prototype
    const pathFor = (method: keyof StrategicBrainController): string =>
      Reflect.getMetadata(PATH_METADATA, proto[method] as (...args: unknown[]) => unknown) as string

    it('binds findMe to the literal `employee/me` path and findOne to the `employee/:id` param path', () => {
      expect(pathFor('findMe')).toBe('employee/me')
      expect(pathFor('findOne')).toBe('employee/:id')
    })

    it('declares the `employee/me` route BEFORE the `employee/:id` route (Nest matches by declaration order)', () => {
      const names = Object.getOwnPropertyNames(proto)
      expect(names.indexOf('findMe')).toBeGreaterThanOrEqual(0)
      expect(names.indexOf('findMe')).toBeLessThan(names.indexOf('findOne'))
    })
  })

  // --- M16: manager scope is applied at the SERVICE call (not the guard) --------------------------
  describe('/overview scope (M16)', () => {
    it('passes a MANAGER their managedUnitIds into SnapshotService.overview', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'u1' }, { unitId: 'u2' }])
      snapshots.overview.mockResolvedValue([{ employeeId: 'e1' }])
      recommendations.listRecruitment.mockResolvedValue([])

      await controller.overview(asClient(client), user([Role.MANAGER]), IP)

      expect(snapshots.overview).toHaveBeenCalledWith(asClient(client), ['u1', 'u2'])
      expect(recommendations.listRecruitment).toHaveBeenCalledWith(asClient(client), ['u1', 'u2'])
    })

    it('calls SnapshotService.overview UNSCOPED (null) for an HR actor and never looks up managed units', async () => {
      snapshots.overview.mockResolvedValue([])
      recommendations.listRecruitment.mockResolvedValue([])

      await controller.overview(asClient(client), user([Role.HR]), IP)

      expect(snapshots.overview).toHaveBeenCalledWith(asClient(client), null)
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })
  })

  // --- M17: PRACOWNIK self via /me; PRACOWNIK barred from /:id by the role gate --------------------
  describe('/employee self + role gate (M17)', () => {
    it('a PRACOWNIK reads their own card via /employee/me (self via keycloakSub)', async () => {
      snapshots.employeeCardByKeycloakSub.mockResolvedValue({ employeeId: 'self' })

      const res = await controller.findMe(asClient(client), user([Role.PRACOWNIK], 'kc-self'), IP)

      expect(res).toEqual({ employeeId: 'self' })
      expect(snapshots.employeeCardByKeycloakSub).toHaveBeenCalledWith(asClient(client), 'kc-self')
    })

    it('the /employee/:id role gate EXCLUDES PRACOWNIK (only HR/ADMIN/MANAGER may read another id)', () => {
      const reflector = new Reflector()
      const roles = reflector.get<string[]>(ROLES_KEY, StrategicBrainController.prototype.findOne) ?? []
      expect(roles).toEqual([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])
      expect(roles).not.toContain(Role.PRACOWNIK)
    })

    it('the /employee/me role gate INCLUDES PRACOWNIK (any authenticated employee)', () => {
      const reflector = new Reflector()
      const roles = reflector.get<string[]>(ROLES_KEY, StrategicBrainController.prototype.findMe) ?? []
      expect(roles).toContain(Role.PRACOWNIK)
    })

    it('passes a MANAGER their scope into SnapshotService.employeeCard for /employee/:id', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'u9' }])
      snapshots.employeeCard.mockResolvedValue({ employeeId: 'e2' })

      await controller.findOne(asClient(client), user([Role.MANAGER]), IP, 'e2')

      expect(snapshots.employeeCard).toHaveBeenCalledWith(asClient(client), 'e2', ['u9'])
    })
  })

  // --- M19: acknowledge logs a human decision with an IDS-ONLY audit payload ----------------------
  describe('POST /recruitment/:id/acknowledge (M19 ids-only audit)', () => {
    it('records the acknowledgement and logs an ids-only audit payload (no PII/rationale/factors)', async () => {
      recommendations.acknowledge.mockResolvedValue({ id: 'reco-1', acknowledgedByUserId: 'kc-1' })

      await controller.acknowledge(asClient(client), user([Role.HR]), IP, 'reco-1')

      // 1) the acknowledgement writes only to the module's OWN recommendation row
      expect(recommendations.acknowledge).toHaveBeenCalledWith(asClient(client), 'reco-1', 'kc-1')

      // 2) the human decision is audited exactly once
      expect(audit.log).toHaveBeenCalledTimes(1)
      const arg = audit.log.mock.calls[0]![0] as {
        actorUserId: string
        action: string
        entityType: string
        entityId: string
        ipAddress: string
        payload: Record<string, unknown>
      }
      expect(arg.actorUserId).toBe('kc-1')
      expect(arg.entityId).toBe('reco-1')
      expect(arg.ipAddress).toBe(IP)
      expect(typeof arg.action).toBe('string')
      expect(typeof arg.entityType).toBe('string')

      // 3) M19: the payload carries ONLY ids — no name/rationale/factors/PII keys, and every value
      //    is a plain id string (a uuid-ish token), never a free-text rationale or a factors object.
      const keys = Object.keys(arg.payload)
      const FORBIDDEN = ['name', 'firstName', 'lastName', 'rationale', 'factors', 'pesel', 'email']
      for (const f of FORBIDDEN) expect(keys).not.toContain(f)
      for (const k of keys) {
        expect(k.toLowerCase()).toMatch(/id$/) // every key names an id
        expect(typeof arg.payload[k]).toBe('string')
      }
      expect(arg.payload.recommendationId).toBe('reco-1')
    })

    it('restricts acknowledge to HR/ADMIN only (no MANAGER, no PRACOWNIK)', () => {
      const reflector = new Reflector()
      const roles = reflector.get<string[]>(ROLES_KEY, StrategicBrainController.prototype.acknowledge) ?? []
      expect(roles).toEqual([Role.HR, Role.ADMIN_KLIENTA])
    })
  })

  // --- recruitment + config delegation ------------------------------------------------------------
  describe('/recruitment + /config delegation', () => {
    it('passes a MANAGER scope into RecommendationService.listRecruitment', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'u1' }])
      recommendations.listRecruitment.mockResolvedValue([{ id: 'r1' }])

      const res = await controller.recruitment(asClient(client), user([Role.MANAGER]), IP)

      expect(res).toEqual([{ id: 'r1' }])
      expect(recommendations.listRecruitment).toHaveBeenCalledWith(asClient(client), ['u1'])
    })

    it('GET /config delegates to PerformanceConfigService.getEffectiveConfig (unitId or null)', async () => {
      config.getEffectiveConfig.mockResolvedValue({ weightPerformance: 0.3 })

      await controller.getConfig(asClient(client), user([Role.HR]), IP, 'unit-7')
      expect(config.getEffectiveConfig).toHaveBeenCalledWith(asClient(client), 'unit-7')

      await controller.getConfig(asClient(client), user([Role.HR]), IP, undefined)
      expect(config.getEffectiveConfig).toHaveBeenCalledWith(asClient(client), null)
    })

    it('PATCH /config delegates to PerformanceConfigService.upsertConfig with the DTO', async () => {
      config.upsertConfig.mockResolvedValue({ id: 'cfg' })
      const dto = { weightPerformance: 0.3, weightTimeliness: 0.25, weightQuality: 0.25, weightDevelopment: 0.2 }

      const res = await controller.updateConfig(asClient(client), user([Role.HR]), IP, dto as never)

      expect(res).toEqual({ id: 'cfg' })
      expect(config.upsertConfig).toHaveBeenCalledWith(asClient(client), dto)
    })

    it('gates overview/recruitment/config to the correct coarse roles', () => {
      const reflector = new Reflector()
      const rolesFor = (m: keyof StrategicBrainController): string[] =>
        reflector.get<string[]>(ROLES_KEY, StrategicBrainController.prototype[m] as (...a: unknown[]) => unknown) ?? []
      expect(rolesFor('overview')).toEqual([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])
      expect(rolesFor('recruitment')).toEqual([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])
      expect(rolesFor('getConfig')).toEqual([Role.HR, Role.ADMIN_KLIENTA])
      expect(rolesFor('updateConfig')).toEqual([Role.HR, Role.ADMIN_KLIENTA])
    })
  })
})
