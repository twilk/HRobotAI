import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import {
  CurrentTenantClient,
  CurrentUser,
} from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { ShiftSwapService, type SwapActor } from './shift-swap.service.js'
import {
  CreateSwapRequestDto,
  ListSwapQueryDto,
  ManagerDecisionDto,
  PeerDecisionDto,
} from './dto/shift-swap.dto.js'

/** Any authenticated tenant user may initiate/track their own swaps; row-level RBAC is in the service. */
const ANY_ROLE = [Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const
/** The manager decision is coarse-gated to management roles; unit scoping is enforced in the service. */
const MANAGER_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * Shift-swap HTTP API (M2 #3 §5). `@TenantRoute()` binds the full tenant pipeline (KeycloakJwtGuard +
 * RbacGuard + TenantContextInterceptor + AuditInterceptor); `@Roles(...)` is the coarse role gate.
 * Row-level RBAC — requester-only submit/cancel, target-only peer-decision, manager-of-unit decision —
 * is enforced by {@link ShiftSwapService}'s `assert*` helpers, mirroring the grafik unit scoping.
 *
 * The state machine + atomic approve-swap live in D1's {@link ShiftSwapService}; this controller only
 * authorises, then delegates. `submit-to-manager` (PEER_AGREED → PENDING_MANAGER) is exposed as its
 * own endpoint so the D1 state machine is reachable end-to-end (SW1 happy path).
 */
@Controller('shift-swap')
@TenantRoute()
export class ShiftSwapController {
  constructor(private readonly swap: ShiftSwapService) {}

  private actor(user: JwtPayload): SwapActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [] }
  }

  @Post()
  @Roles(...ANY_ROLE)
  async create(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSwapRequestDto,
  ): Promise<unknown> {
    return this.swap.create(client, this.actor(user), dto)
  }

  @Get()
  @Roles(...ANY_ROLE)
  async list(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListSwapQueryDto,
  ): Promise<unknown[]> {
    return this.swap.list(client, this.actor(user), { state: query.state, mine: query.mine })
  }

  @Post(':id/submit')
  @Roles(...ANY_ROLE)
  @HttpCode(HttpStatus.OK)
  async submit(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    await this.swap.assertRequester(client, this.actor(user), id)
    return this.swap.submit(client, id)
  }

  @Post(':id/peer-decision')
  @Roles(...ANY_ROLE)
  @HttpCode(HttpStatus.OK)
  async peerDecision(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PeerDecisionDto,
  ): Promise<unknown> {
    await this.swap.assertTarget(client, this.actor(user), id)
    return this.swap.peerDecision(client, id, dto.accept)
  }

  @Post(':id/submit-to-manager')
  @Roles(...ANY_ROLE)
  @HttpCode(HttpStatus.OK)
  async submitToManager(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    await this.swap.assertRequester(client, this.actor(user), id)
    return this.swap.submitToManager(client, id)
  }

  @Post(':id/manager-decision')
  @Roles(...MANAGER_ROLES)
  @HttpCode(HttpStatus.OK)
  async managerDecision(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManagerDecisionDto,
  ): Promise<unknown> {
    await this.swap.assertManager(client, this.actor(user), id)
    return this.swap.managerDecision(client, id, {
      approve: dto.approve,
      decidedByManagerId: user.sub,
      actorUserId: user.sub,
      ipAddress: ip,
    })
  }

  @Post(':id/cancel')
  @Roles(...ANY_ROLE)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    await this.swap.assertRequester(client, this.actor(user), id)
    return this.swap.cancel(client, id)
  }
}
