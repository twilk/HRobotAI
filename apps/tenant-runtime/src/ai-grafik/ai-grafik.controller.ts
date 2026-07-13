import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { AiConfigService, type AiConfigActor } from './ai-config.service.js'
import { ReplacementService } from './replacement.service.js'
import { AiProposalService } from './ai-proposal.service.js'
import { UpdateAiConfigDto } from './dto/ai-config.dto.js'
import { ScanRangeDto } from './dto/scan-range.dto.js'
import { CreateProposalDto } from './dto/create-proposal.dto.js'
import { ConsentDto } from './dto/consent.dto.js'
import { ManagerDecisionDto } from './dto/manager-decision.dto.js'

/** MANAGER/HR/ADMIN may read + write AI config; the service scopes a MANAGER to their managed unit(s). */
const CONFIG_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

@Controller('ai-grafik')
@TenantRoute()
export class AiGrafikController {
  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly replacement: ReplacementService,
    private readonly proposals: AiProposalService,
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

  // Manual "znajdź zastępstwo" (Task 1.3): rank candidates for the vacated shift and create an AI
  // proposal whose INITIAL state is gated on the unit's autonomy level. MANAGER is unit-scoped in the
  // service; HR/ADMIN act across units.
  @Post('proposals/for-shift/:shiftId')
  @Roles(...CONFIG_ROLES)
  async createProposal(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() dto: CreateProposalDto,
  ): Promise<unknown> {
    return this.proposals.createReplacement(client, this.actor(user, ip), shiftId, dto.reason)
  }

  // List proposals. A PRACOWNIK passes `mine=true` to see only proposals awaiting THEIR consent;
  // MANAGER/HR/ADMIN see their in-scope proposals (scoping enforced in the service).
  @Get('proposals')
  @Roles(Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA)
  async listProposals(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query('mine') mine?: string,
    @Query('state') state?: string,
  ): Promise<unknown> {
    return this.proposals.list(client, this.actor(user, ip), { mine: mine === 'true', state })
  }

  // Read one proposal, scoped identically to the list route.
  @Get('proposals/:id')
  @Roles(Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA)
  async getProposal(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.proposals.getById(client, this.actor(user, ip), id)
  }

  // The asked employee answers their consent request (Task 1.4). Any role may hold an employee record,
  // but the service enforces that the caller IS the proposal's active (asked) candidate.
  @Post('proposals/:id/consent')
  @Roles(Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA)
  async consent(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConsentDto,
  ): Promise<unknown> {
    return this.proposals.employeeConsent(client, this.actor(user, ip), id, dto.accept)
  }

  // A manager approves/rejects a proposal awaiting review (Task 1.4). Approve runs the transactional
  // replacement commit; the service authorizes the manager against the vacated shift's unit.
  @Post('proposals/:id/manager-decision')
  @Roles(Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA)
  async managerDecision(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManagerDecisionDto,
  ): Promise<unknown> {
    return this.proposals.managerDecision(client, this.actor(user, ip), id, { approve: dto.approve })
  }
}
