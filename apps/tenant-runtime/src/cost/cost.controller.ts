import { BadRequestException, Controller, Get, Ip, Patch, Body, Query } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { CostService, type CostActor } from './cost.service.js'
import { UpsertRateDto } from './dto/upsert-rate.dto.js'

/** Rate + week-cost reads: MANAGER/HR/ADMIN (a MANAGER is unit-scoped inside `CostService`). */
const READ_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const
/** (Codex P1-1) Rate/budget WRITES are HR/ADMIN only — this NEVER reuses `PATCH /ai-grafik/config`'s
 *  `[MANAGER, HR, ADMIN_KLIENTA]` gate, which would let a MANAGER edit the budget. */
const WRITE_ROLES = [Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * Standard cost-rate catalog + weekly cost/budget status (SP4). `@TenantRoute()` binds the full
 * tenant pipeline (auth + RBAC + tenant-context + audit) class-wide; `CostService` re-checks the
 * HR/ADMIN write gate itself so a controller-only mistake can never widen it.
 */
@Controller('koszty')
@TenantRoute()
export class CostController {
  constructor(private readonly cost: CostService) {}

  private actor(user: JwtPayload, ip: string): CostActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  @Get('rates')
  @Roles(...READ_ROLES)
  async getRates(@CurrentTenantClient() client: TenantClient): Promise<unknown> {
    return this.cost.getRates(client)
  }

  // HR/ADMIN only (Codex P1-1) — never the config route's MANAGER-inclusive roles.
  @Patch('rates')
  @Roles(...WRITE_ROLES)
  async upsertRate(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: UpsertRateDto,
  ): Promise<unknown> {
    return this.cost.upsertRate(client, this.actor(user, ip), dto)
  }

  // Week cost + budget status + missingRates. A MANAGER MUST pass unitId (Codex P1-3) — enforced in
  // CostService.assertWeekScope, not here, so the 403 message stays centralized.
  @Get('week')
  @Roles(...READ_ROLES)
  async week(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query('weekStart') weekStart: string,
    @Query('unitId') unitId?: string,
  ): Promise<unknown> {
    const date = this.parseWeekStart(weekStart)
    return this.cost.budgetStatus(client, this.actor(user, ip), unitId, date)
  }

  private parseWeekStart(weekStart: string): Date {
    if (!weekStart) throw new BadRequestException('weekStart is required')
    const date = new Date(weekStart)
    if (Number.isNaN(date.getTime())) throw new BadRequestException('weekStart must be a valid ISO date')
    return date
  }
}
