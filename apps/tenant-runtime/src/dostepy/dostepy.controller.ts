import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { AccessService, type AccessActor } from './dostepy.service.js'
import { IssueAccessDto, RevokeDto } from './dto/access.dto.js'

/** Only a MANAGER/HR/ADMIN_KLIENTA may manage access grants; the service scopes what each may see or do. */
const ACCESS_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

@Controller('dostepy')
@TenantRoute()
export class DostepyController {
  constructor(private readonly access: AccessService) {}

  private actor(user: JwtPayload, ip: string): AccessActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  // Scoping (global→all, MANAGER→managed units) is enforced in AccessService.list.
  @Get()
  @Roles(...ACCESS_ROLES)
  async list(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ): Promise<unknown> {
    return this.access.list(client, this.actor(user, ip), { employeeId, status })
  }

  // RBAC: MANAGER/HR/ADMIN only. The service authorizes the target employee's unit (else 403).
  @Post()
  @Roles(...ACCESS_ROLES)
  async issue(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: IssueAccessDto,
  ): Promise<unknown> {
    return this.access.issue(client, this.actor(user, ip), dto)
  }

  // RBAC: MANAGER/HR/ADMIN only. Same scope as issue; optimistic-locked on status ACTIVE in the service.
  @Post(':id/revoke')
  @Roles(...ACCESS_ROLES)
  async revoke(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeDto,
  ): Promise<unknown> {
    return this.access.revoke(client, this.actor(user, ip), id, { reason: dto.reason })
  }

  // Same scope as list; an out-of-scope id → 403 (enforced in the service).
  @Get(':id')
  @Roles(...ACCESS_ROLES)
  async getOne(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.access.getById(client, this.actor(user, ip), id)
  }
}
