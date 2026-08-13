import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AgentGlosowyController } from './agent-glosowy.controller.js'
import { VoiceCommandService } from './voice-command.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const voice = { interpret: jest.fn(), execute: jest.fn() }
const client = {} as unknown as TenantClient
const IP = '9.9.9.9'
const user = (roles: string[], sub = 'kc-1'): JwtPayload => ({ sub, iss: 'x', hrobot_roles: roles, exp: 0 })

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('AgentGlosowyController', () => {
  let controller: AgentGlosowyController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentGlosowyController],
      providers: [{ provide: VoiceCommandService, useValue: voice }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(AgentGlosowyController)
    jest.clearAllMocks()
  })

  it('interpret delegates to the service with the actor projected from the JWT (acts as self)', () => {
    voice.interpret.mockReturnValue({ intent: 'MOJ_GRAFIK' })
    controller.interpret(user([Role.PRACOWNIK], 'kc-self'), IP, { text: 'jaki mam grafik jutro' })

    expect(voice.interpret).toHaveBeenCalledTimes(1)
    const [text, today, actor] = voice.interpret.mock.calls[0]
    expect(text).toBe('jaki mam grafik jutro')
    expect(today).toBeInstanceOf(Date)
    expect(actor).toEqual({ userId: 'kc-self', roles: [Role.PRACOWNIK], ipAddress: IP })
  })

  it('execute delegates to the service, forwarding intent/entities/confirm and the actor', async () => {
    voice.execute.mockResolvedValue({ executed: true })
    await controller.execute(client, user([Role.PRACOWNIK], 'kc-self'), IP, {
      intent: 'URLOP',
      entities: { dateFrom: '2026-08-01', dateTo: '2026-08-05', type: 'URLOP_WYPOCZYNKOWY' },
      confirm: true,
    })

    expect(voice.execute).toHaveBeenCalledTimes(1)
    const [passedClient, actor, params] = voice.execute.mock.calls[0]
    expect(passedClient).toBe(client)
    expect(actor).toEqual({ userId: 'kc-self', roles: [Role.PRACOWNIK], ipAddress: IP })
    expect(params).toEqual({
      intent: 'URLOP',
      entities: { dateFrom: '2026-08-01', dateTo: '2026-08-05', type: 'URLOP_WYPOCZYNKOWY' },
      confirm: true,
    })
  })

  it('defaults missing entities to {} so execute never receives undefined slots', async () => {
    voice.execute.mockResolvedValue({ executed: false })
    await controller.execute(client, user([Role.PRACOWNIK]), IP, { intent: 'NIEZNANE' })
    expect(voice.execute.mock.calls[0][2].entities).toEqual({})
  })

  it('gates BOTH routes to any authenticated employee (incl. PRACOWNIK)', () => {
    const reflector = new Reflector()
    for (const m of ['interpret', 'execute'] as const) {
      const roles = reflector.get<string[]>(ROLES_KEY, AgentGlosowyController.prototype[m]) ?? []
      expect(roles).toEqual([Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
    }
  })
})
