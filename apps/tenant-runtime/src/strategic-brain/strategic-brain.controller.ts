import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { SnapshotService } from './snapshot.service.js'
import { RecommendationService } from './recommendation.service.js'
import { PerformanceConfigService } from './performance-config.service.js'
import { UpdatePerformanceConfigDto } from './dto/performance-config.dto.js'

/** HR/ADMIN act across every unit; a MANAGER is unit-scoped (scope applied in the SERVICE, M16). */
const OVERVIEW_ROLES = [Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER] as const
/** Any authenticated employee (incl. a plain PRACOWNIK) may read THEIR OWN card via `/employee/me`. */
const SELF_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK] as const
/** Only HR/ADMIN acknowledge a recommendation or read/write the scoring config. */
const ADMIN_ROLES = [Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * `strategic-brain` HTTP surface (spec §6, §14 findings M16/M17/M18/M19; plan Task 9). A THIN
 * controller: it verifies the coarse role via `@TenantRoute()`'s `RbacGuard` + `@Roles`, then
 * delegates every read/write to a service. Two responsibilities live HERE by design:
 *
 *  - [M16] Manager unit-scope is SERVICE-LEVEL, not guard-level. The `RbacGuard` only checks the
 *    coarse `hrobot_roles` claim; it does NOT know about units. So for each in-scope endpoint the
 *    controller resolves the caller's scope ({@link resolveScope}: `null` for a GLOBAL HR/ADMIN,
 *    else their `managedUnitIds`) and PASSES it into the service call, which does the actual
 *    row-level filtering. A GLOBAL actor never even looks up managed units.
 *  - [M19] The acknowledge audit payload is built by hand as IDS-ONLY. `AuditService` accepts any
 *    payload (it does not enforce minimization), so the controller constructs `{ recommendationId }`
 *    explicitly — no name, no rationale, no factors, no PII ever reaches `audit_log`.
 *
 * RODO art. 22 (M13): `acknowledge` logs a HUMAN decision and stamps the recommendation's own
 * `acknowledgedBy*` columns; it performs NO personnel action.
 */
@Controller('strategic-brain')
@TenantRoute()
export class StrategicBrainController {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly recommendations: RecommendationService,
    private readonly config: PerformanceConfigService,
    private readonly audit: AuditService,
  ) {}

  /** [M16] `null` ⇒ GLOBAL actor (HR/ADMIN, unscoped); else the caller's managed unit ids. A GLOBAL
   * actor short-circuits BEFORE any `managedUnitIds` DB lookup. */
  private async resolveScope(client: TenantClient, user: JwtPayload): Promise<string[] | null> {
    return isGlobal(user.hrobot_roles ?? []) ? null : managedUnitIds(client, user.sub)
  }

  // Heatmap + recruitment feed. MANAGER is scoped to their managed unit(s) in the services (M16).
  @Get('overview')
  @Roles(...OVERVIEW_ROLES)
  async overview(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() _ip: string,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    const [heatmap, recruitment] = await Promise.all([
      this.snapshots.overview(client, scope),
      this.recommendations.listRecruitment(client, scope),
    ])
    return { heatmap, recruitment }
  }

  // Route ordering is load-bearing (M17): this literal `employee/me` path MUST stay declared BEFORE
  // `@Get('employee/:id')`, otherwise Nest matches `/employee/me` against the `:id` route and
  // ParseUUIDPipe rejects `me` (400). Self is resolved via the caller's Keycloak subject — no scope.
  @Get('employee/me')
  @Roles(...SELF_ROLES)
  async findMe(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() _ip: string,
  ): Promise<unknown> {
    return this.snapshots.employeeCardByKeycloakSub(client, user.sub)
  }

  // Another employee's card — HR/ADMIN/MANAGER only (a PRACOWNIK is barred by the role gate and must
  // use /employee/me). MANAGER scope enforced in the service (404 unknown → 403 out-of-scope).
  @Get('employee/:id')
  @Roles(...OVERVIEW_ROLES)
  async findOne(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() _ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    return this.snapshots.employeeCard(client, id, scope)
  }

  // Current recruitment recommendations per location. MANAGER scoped in the service (M16).
  @Get('recruitment')
  @Roles(...OVERVIEW_ROLES)
  async recruitment(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() _ip: string,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    return this.recommendations.listRecruitment(client, scope)
  }

  // [M19/M13] Log a HUMAN acknowledgement of a recommendation. Stamps the recommendation's own
  // `acknowledgedBy*` columns (service) and writes an IDS-ONLY audit entry (here). Performs NO
  // personnel action — RODO art. 22: the AI recommends, a human decides.
  @Post('recruitment/:id/acknowledge')
  @Roles(...ADMIN_ROLES)
  async acknowledge(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    const updated = await this.recommendations.acknowledge(client, id, user.sub)
    // [M19] ids-only payload, built by hand — NO name/rationale/factors/PII. `actorUserId` +
    // `entityId` already carry the who/what at the top level; the payload adds only the id again.
    await this.audit.log({
      tenantClient: client,
      actorUserId: user.sub,
      action: 'strategic-brain.recruitment.acknowledge',
      entityType: 'RecruitmentRecommendation',
      entityId: id,
      payload: { recommendationId: id },
      ipAddress: ip,
    })
    return updated
  }

  // Effective scoring config for a unit (or the tenant default when `unitId` is absent).
  @Get('config')
  @Roles(...ADMIN_ROLES)
  async getConfig(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() _user: JwtPayload,
    @Ip() _ip: string,
    @Query('unitId') unitId?: string,
  ): Promise<unknown> {
    return this.config.getEffectiveConfig(client, unitId ?? null)
  }

  // Upsert config. Weight-sum (Σ=1.00) validation lives in PerformanceConfigService.upsertConfig.
  @Patch('config')
  @Roles(...ADMIN_ROLES)
  async updateConfig(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() _user: JwtPayload,
    @Ip() _ip: string,
    @Body() dto: UpdatePerformanceConfigDto,
  ): Promise<unknown> {
    return this.config.upsertConfig(client, dto)
  }
}
