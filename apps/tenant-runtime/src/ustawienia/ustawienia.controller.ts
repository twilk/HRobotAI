import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { SettingsService, type SettingsActor } from './ustawienia.service.js'
import { CreateUnitDto, UpdateCompanyDto, UpdateUnitDto } from './dto/ustawienia.dto.js'

/** MANAGER/HR/ADMIN may READ company settings + the org tree. */
const READ_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const

@Controller('ustawienia')
@TenantRoute()
export class UstawieniaController {
  constructor(private readonly settings: SettingsService) {}

  private actor(user: JwtPayload, ip: string): SettingsActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  @Get('company')
  @Roles(...READ_ROLES)
  async getCompany(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown> {
    return this.settings.getCompany(client, this.actor(user, ip))
  }

  // RBAC: ADMIN_KLIENTA only — re-checked (defense-in-depth) in SettingsService.upsertCompany.
  @Patch('company')
  @Roles(Role.ADMIN_KLIENTA)
  async updateCompany(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<unknown> {
    return this.settings.upsertCompany(client, this.actor(user, ip), dto)
  }

  @Get('units')
  @Roles(...READ_ROLES)
  async listUnits(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown> {
    return this.settings.listUnits(client, this.actor(user, ip))
  }

  // RBAC: ADMIN_KLIENTA only — re-checked (defense-in-depth) in SettingsService.createUnit.
  @Post('units')
  @Roles(Role.ADMIN_KLIENTA)
  async createUnit(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: CreateUnitDto,
  ): Promise<unknown> {
    return this.settings.createUnit(client, this.actor(user, ip), dto)
  }

  // RBAC: ADMIN_KLIENTA only — re-checked in SettingsService.updateUnit (cycle-guarded reparent).
  @Patch('units/:id')
  @Roles(Role.ADMIN_KLIENTA)
  async updateUnit(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ): Promise<unknown> {
    return this.settings.updateUnit(client, this.actor(user, ip), id, dto)
  }
}
