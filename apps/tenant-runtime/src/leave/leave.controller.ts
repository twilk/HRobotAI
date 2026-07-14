import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { LeaveService, type LeaveActor } from './leave.service.js'
import { CreateLeaveDto, DecideDto } from './dto/leave.dto.js'

/** Any tenant role may file/list/read/cancel a request; the service scopes what each may see or do. */
const ANY_ROLE = [Role.PRACOWNIK, Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const
/** Only a MANAGER/HR/ADMIN may decide (approve/reject) — re-checked (defense-in-depth) in the service. */
const DECIDE_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

@Controller('wnioski')
@TenantRoute()
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  private actor(user: JwtPayload, ip: string): LeaveActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  // RBAC: any role may file. A non-global caller's dto.employeeId is ignored (files against self).
  @Post()
  @Roles(...ANY_ROLE)
  async create(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: CreateLeaveDto,
  ): Promise<unknown> {
    return this.leave.createRequest(client, this.actor(user, ip), dto)
  }

  // Scoping (global→all, MANAGER→managed units, PRACOWNIK→own) is enforced in LeaveService.list.
  @Get()
  @Roles(...ANY_ROLE)
  async list(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query('mine') mine?: string,
    @Query('state') state?: string,
    @Query('unitId') unitId?: string,
  ): Promise<unknown> {
    return this.leave.list(client, this.actor(user, ip), { mine: mine === 'true', state, unitId })
  }

  // Same scope as list; an out-of-scope id → 403 (enforced in the service).
  @Get(':id')
  @Roles(...ANY_ROLE)
  async getOne(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.leave.getById(client, this.actor(user, ip), id)
  }

  // RBAC: MANAGER/HR/ADMIN only. MAKER-CHECKER (no self-approval) + optimistic lock in the service.
  @Post(':id/decision')
  @Roles(...DECIDE_ROLES)
  async decide(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDto,
  ): Promise<unknown> {
    return this.leave.decide(client, this.actor(user, ip), id, { approve: dto.approve, reason: dto.reason })
  }

  // RBAC: any role, but the service allows ONLY the requester to cancel their own PENDING request.
  @Post(':id/cancel')
  @Roles(...ANY_ROLE)
  async cancel(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.leave.cancel(client, this.actor(user, ip), id)
  }
}
