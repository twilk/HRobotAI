import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { OnboardingController, OnboardingDto } from './onboarding.controller.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'

const mockPrisma = { tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() } }
const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('OnboardingController', () => {
  let controller: OnboardingController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [{ provide: ControlPlanePrismaService, useValue: mockPrisma }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(OnboardingController)
    jest.clearAllMocks()
  })

  it('merges partial update into existing checklist', async () => {
    const existing = { addEmployees: false, configureSchedule: false, inviteUsers: false }
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ onboardingChecklist: existing })
    mockPrisma.tenant.update.mockResolvedValue({
      onboardingChecklist: { ...existing, addEmployees: true },
    })

    const dto: OnboardingDto = { addEmployees: true }
    const result = await controller.update('tenant-1', dto)
    expect(result).toEqual({ ...existing, addEmployees: true })

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { onboardingChecklist: { addEmployees: true, configureSchedule: false, inviteUsers: false } },
      select: { onboardingChecklist: true },
    })
  })

  it('preserves keys absent from the partial update', async () => {
    const existing = { addEmployees: true, configureSchedule: false, inviteUsers: false }
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ onboardingChecklist: existing })
    mockPrisma.tenant.update.mockResolvedValue({
      onboardingChecklist: { ...existing, inviteUsers: true },
    })

    await controller.update('tenant-1', { inviteUsers: true })

    const call = mockPrisma.tenant.update.mock.calls[0]?.[0] as { data: { onboardingChecklist: Record<string, boolean> } }
    expect(call.data.onboardingChecklist['addEmployees']).toBe(true) // preserved
    expect(call.data.onboardingChecklist['inviteUsers']).toBe(true)  // updated
  })
})
