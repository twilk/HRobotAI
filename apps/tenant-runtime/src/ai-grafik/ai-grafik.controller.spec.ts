import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AiGrafikController } from './ai-grafik.controller.js'
import { AiConfigService } from './ai-config.service.js'
import { ReplacementService } from './replacement.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const mockService = {
  getConfig: jest.fn(),
  upsertConfig: jest.fn(),
}
const mockReplacement = {
  findVacatedShifts: jest.fn(),
}
const client = {} as TenantClient
const user: JwtPayload = { sub: 'kc-1', iss: 'x', hrobot_roles: [Role.HR], exp: 0 }

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('AiGrafikController', () => {
  let controller: AiGrafikController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiGrafikController],
      providers: [
        { provide: AiConfigService, useValue: mockService },
        { provide: ReplacementService, useValue: mockReplacement },
      ],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(AiGrafikController)
    jest.clearAllMocks()
  })

  it('delegates getConfig to AiConfigService.getConfig with an actor + optional unitId query', async () => {
    mockService.getConfig.mockResolvedValue({ autonomyLevel: 'SUGGEST_ONLY' })

    const result = await controller.getConfig(client, user, '1.2.3.4', 'unit-A')

    expect(result).toEqual({ autonomyLevel: 'SUGGEST_ONLY' })
    expect(mockService.getConfig).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'unit-A',
    )
  })

  it('delegates updateConfig to AiConfigService.upsertConfig with the actor and dto', async () => {
    mockService.upsertConfig.mockResolvedValue({ id: 'cfg-1' })

    const dto = { unitId: 'unit-A', autonomyLevel: 'AUTO_NOTIFY' as const }
    const result = await controller.updateConfig(client, user, '1.2.3.4', dto)

    expect(result).toEqual({ id: 'cfg-1' })
    expect(mockService.upsertConfig).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      dto,
    )
  })

  it('delegates scan to ReplacementService.findVacatedShifts with the actor and range', async () => {
    mockReplacement.findVacatedShifts.mockResolvedValue([{ id: 'shift-1' }])

    const range = { from: '2026-07-01', to: '2026-07-31' }
    const result = await controller.scan(client, user, '1.2.3.4', range)

    expect(result).toEqual([{ id: 'shift-1' }])
    expect(mockReplacement.findVacatedShifts).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      range,
    )
  })

  // --- RBAC metadata: proves the role gate wired to each route ------------------------------------

  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (method: keyof AiGrafikController): string[] =>
      reflector.get<string[]>(ROLES_KEY, AiGrafikController.prototype[method] as (...args: unknown[]) => unknown) ?? []

    it('restricts getConfig to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('getConfig')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts updateConfig to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('updateConfig')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts scan to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('scan')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })
  })
})
