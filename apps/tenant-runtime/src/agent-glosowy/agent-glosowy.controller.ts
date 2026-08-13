import { Body, Controller, Ip, Post } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { VoiceCommandService, type ExecuteResult, type InterpretResult, type VoiceActor } from './voice-command.service.js'
import { ExecuteDto, InterpretDto } from './dto/agent-glosowy.dto.js'

/** Any authenticated employee may talk to the agent; it always acts AS them (self, no escalation). */
const ANY_ROLE = [Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * `agent-glosowy` HTTP surface (M3 module 3 — Agent Głosowy). A THIN controller mirroring
 * `strategic-brain`/`leave`: `@TenantRoute()` binds the full tenant pipeline (KeycloakJwtGuard +
 * RbacGuard + TenantContext + Audit interceptors) and `@Roles` sets the coarse gate; the actor is
 * projected from `CurrentUser` and passed down so the service acts AS the caller.
 *
 * Two routes, TEXT-only (audio/STT is an out-of-process seam — see `stt.port.ts`):
 *  - `POST /agent-glosowy/interpret` — parse + describe what WOULD happen (no side effect).
 *  - `POST /agent-glosowy/execute`   — run it behind the human-confirmation gate (writes need
 *    `confirm: true`; the gate lives in {@link VoiceCommandService.execute}).
 */
@Controller('agent-glosowy')
@TenantRoute()
export class AgentGlosowyController {
  constructor(private readonly voice: VoiceCommandService) {}

  private actor(user: JwtPayload, ip: string): VoiceActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  /** Deterministic UTC-midnight "today" reference the pure parser resolves relative dates against. */
  private today(): Date {
    return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  }

  @Post('interpret')
  @Roles(...ANY_ROLE)
  interpret(@CurrentUser() user: JwtPayload, @Ip() ip: string, @Body() dto: InterpretDto): InterpretResult {
    return this.voice.interpret(dto.text, this.today(), this.actor(user, ip))
  }

  @Post('execute')
  @Roles(...ANY_ROLE)
  execute(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: ExecuteDto,
  ): Promise<ExecuteResult> {
    return this.voice.execute(
      client,
      this.actor(user, ip),
      { intent: dto.intent, entities: dto.entities ?? {}, confirm: dto.confirm },
      this.today(),
    )
  }
}
