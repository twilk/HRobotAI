import { Body, Controller, Get, Ip, Patch, Post, Query } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { AiConfigService, type AiConfigActor } from './ai-config.service.js'
import { ReplacementService } from './replacement.service.js'
import { UpdateAiConfigDto } from './dto/ai-config.dto.js'
import { ScanRangeDto } from './dto/scan-range.dto.js'

/** MANAGER/HR/ADMIN may read + write AI config; the service scopes a MANAGER to their managed unit(s). */
const CONFIG_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

@Controller('ai-grafik')
@TenantRoute()
export class AiGrafikController {
  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly replacement: ReplacementService,
  ) {}

  private actor(user: JwtPayload, ip: string): AiConfigActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  // Unit-scoping (MANAGER → managed unit(s) only) is enforced in AiConfigService.getConfig.
  @Get('config')
  @Roles(...CONFIG_ROLES)
  async getConfig(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query('unitId') unitId?: string,
  ): Promise<unknown> {
    return this.aiConfig.getConfig(client, this.actor(user, ip), unitId)
  }

  // RBAC: MANAGER may only write their managed unit's config — re-checked in AiConfigService.upsertConfig.
  @Patch('config')
  @Roles(...CONFIG_ROLES)
  async updateConfig(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: UpdateAiConfigDto,
  ): Promise<unknown> {
    return this.aiConfig.upsertConfig(client, this.actor(user, ip), dto)
  }

  // Vacated-shift detection (Task 1.2). MANAGER is unit-scoped inside the service; HR/ADMIN see all.
  // DETECTS only — returns the vacated shifts (assigned employee on APPROVED leave over the shift's
  // date); it does NOT create proposals or mutate anything.
  @Post('replacements/scan')
  @Roles(...CONFIG_ROLES)
  async scan(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() range: ScanRangeDto,
  ): Promise<unknown> {
    return this.replacement.findVacatedShifts(client, this.actor(user, ip), range)
  }
}
