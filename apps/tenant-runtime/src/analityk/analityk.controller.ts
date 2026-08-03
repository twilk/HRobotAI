import { Controller, Get, Ip, Query } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { AnalitykService, type AnalitykActor, type UnitScope } from './analityk.service.js'
import { buildRange, type AnalitykRange } from './analityk.range.js'
import { AnalitykRangeQueryDto } from './dto/analityk.dto.js'

/**
 * Analityk HR is a MANAGEMENT surface: HR and ADMIN_KLIENTA read the whole tenant, a MANAGER reads
 * only the unit(s) they manage, and a plain PRACOWNIK has NO access at all — aggregate workforce
 * analytics is not self-service data. PRACOWNIK is therefore absent from this list, which makes
 * `RbacGuard` answer their request with a 403 before the controller body ever runs.
 */
const ANALITYK_ROLES = [Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER] as const

/**
 * `analityk` HTTP surface (M3 — Analityk HR). A THIN, fully READ-ONLY controller: `@TenantRoute()`
 * wires the Keycloak guard + tenant-context interceptor, `@Roles` checks the coarse role, and every
 * route then does exactly two things — parse the `[od, do]` range and resolve the caller's unit scope
 * — before delegating the aggregation to {@link AnalitykService}.
 *
 * The coarse `RbacGuard` knows roles but NOT units, so per-unit scoping (the MANAGER restriction and
 * the `unitId` intersection) lives in `AnalitykService.resolveScope`, mirroring the service-level
 * scoping convention of `LeaveService` and `strategic-brain`. No route writes anything, so — unlike
 * the leave/dostepy controllers — none of them emit an audit entry.
 */
@Controller('analityk')
@TenantRoute()
export class AnalitykController {
  constructor(private readonly analityk: AnalitykService) {}

  private actor(user: JwtPayload, ip: string): AnalitykActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  /** Parse + validate the range and resolve the RBAC unit scope — the preamble every route shares. */
  private async prepare(
    client: TenantClient,
    user: JwtPayload,
    ip: string,
    query: AnalitykRangeQueryDto,
  ): Promise<{ scope: UnitScope; range: AnalitykRange }> {
    const range = buildRange(query.od, query.do)
    const scope = await this.analityk.resolveScope(client, this.actor(user, ip), query.unitId)
    return { scope, range }
  }

  /** Everything the Analityk screen needs on mount, in one round trip. */
  @Get()
  @Roles(...ANALITYK_ROLES)
  async podsumowanie(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.podsumowanie(client, scope, range)
  }

  /** Headcount, unit/location split, and hire-vs-departure dynamics. */
  @Get('zatrudnienie')
  @Roles(...ANALITYK_ROLES)
  async zatrudnienie(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.zatrudnienie(client, scope, range)
  }

  /** Absence rate overall and per unit, split by leave type. */
  @Get('absencje')
  @Roles(...ANALITYK_ROLES)
  async absencje(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.absencje(client, scope, range)
  }

  /** Worked hours, overtime, deficit and the daily average, from the realized roster. */
  @Get('czas-pracy')
  @Roles(...ANALITYK_ROLES)
  async czasPracy(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.czasPracy(client, scope, range)
  }

  /** Annual-leave utilization, balance distribution and the forfeiture-risk list. */
  @Get('urlopy')
  @Roles(...ANALITYK_ROLES)
  async urlopy(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.urlopy(client, scope, range)
  }

  /** Request throughput, rejection share, time-to-decision and the approval bottlenecks. */
  @Get('wnioski')
  @Roles(...ANALITYK_ROLES)
  async wnioski(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.wnioski(client, scope, range)
  }

  /** The headline KPIs against the immediately preceding window of equal length. */
  @Get('porownanie')
  @Roles(...ANALITYK_ROLES)
  async porownanie(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.porownanie(client, scope, range)
  }

  /** Rules that fired on the period-over-period comparison — observation only, never an action. */
  @Get('anomalie')
  @Roles(...ANALITYK_ROLES)
  async anomalie(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query() query: AnalitykRangeQueryDto,
  ): Promise<unknown> {
    const { scope, range } = await this.prepare(client, user, ip, query)
    return this.analityk.anomalie(client, scope, range)
  }
}
