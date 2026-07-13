import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AiGrafikController } from './ai-grafik.controller.js'
import { AiConfigService } from './ai-config.service.js'
import { ReplacementService } from './replacement.service.js'
import { AiProposalService } from './ai-proposal.service.js'
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
const mockProposals = {
  createReplacement: jest.fn(),
  list: jest.fn(),
  getById: jest.fn(),
  employeeConsent: jest.fn(),
  managerDecision: jest.fn(),
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
        { provide: AiProposalService, useValue: mockProposals },
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

  it('delegates createProposal to AiProposalService.createReplacement with the actor, shiftId and reason', async () => {
    mockProposals.createReplacement.mockResolvedValue({ id: 'prop-1', state: 'DRAFT' })

    const result = await controller.createProposal(client, user, '1.2.3.4', 'shift-9', { reason: 'urlop' })

    expect(result).toEqual({ id: 'prop-1', state: 'DRAFT' })
    expect(mockProposals.createReplacement).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'shift-9',
      'urlop',
    )
  })

  it('delegates listProposals to AiProposalService.list with a parsed filter', async () => {
    mockProposals.list.mockResolvedValue([{ id: 'prop-1' }])

    const result = await controller.listProposals(client, user, '1.2.3.4', 'true', 'DRAFT')

    expect(result).toEqual([{ id: 'prop-1' }])
    expect(mockProposals.list).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      { mine: true, state: 'DRAFT' },
    )
  })

  it('listProposals rejects an unknown ?state= value with a BadRequestException, never reaching the service', async () => {
    await expect(controller.listProposals(client, user, '1.2.3.4', undefined, 'GARBAGE')).rejects.toThrow(
      'state must be one of',
    )
    expect(mockProposals.list).not.toHaveBeenCalled()
  })

  it('listProposals allows an absent ?state= (no filter)', async () => {
    mockProposals.list.mockResolvedValue([])

    await controller.listProposals(client, user, '1.2.3.4', undefined, undefined)

    expect(mockProposals.list).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      { mine: false, state: undefined },
    )
  })

  it('delegates getProposal to AiProposalService.getById', async () => {
    mockProposals.getById.mockResolvedValue({ id: 'prop-1' })

    const result = await controller.getProposal(client, user, '1.2.3.4', 'prop-1')

    expect(result).toEqual({ id: 'prop-1' })
    expect(mockProposals.getById).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'prop-1',
    )
  })

  it('delegates consent to AiProposalService.employeeConsent with the parsed accept flag', async () => {
    mockProposals.employeeConsent.mockResolvedValue({ id: 'prop-1', state: 'PENDING_MANAGER' })

    const result = await controller.consent(client, user, '1.2.3.4', 'prop-1', { accept: true })

    expect(result).toEqual({ id: 'prop-1', state: 'PENDING_MANAGER' })
    expect(mockProposals.employeeConsent).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'prop-1',
      true,
    )
  })

  it('delegates managerDecision to AiProposalService.managerDecision with the approve flag', async () => {
    mockProposals.managerDecision.mockResolvedValue({ id: 'prop-1', state: 'APPROVED' })

    const result = await controller.managerDecision(client, user, '1.2.3.4', 'prop-1', { approve: true })

    expect(result).toEqual({ id: 'prop-1', state: 'APPROVED' })
    expect(mockProposals.managerDecision).toHaveBeenCalledWith(
      client,
      { userId: 'kc-1', roles: [Role.HR], ipAddress: '1.2.3.4' },
      'prop-1',
      { approve: true },
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

    it('restricts createProposal to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('createProposal')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('opens listProposals to PRACOWNIK/MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('listProposals')).toEqual([Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('opens getProposal to PRACOWNIK/MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('getProposal')).toEqual([Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('opens consent to PRACOWNIK/MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('consent')).toEqual([Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })

    it('restricts managerDecision to MANAGER/HR/ADMIN_KLIENTA', () => {
      expect(rolesFor('managerDecision')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    })
  })
})
