import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { GrafikService, type GrafikActor, type SolveGrafikResult } from './grafik.service.js'
import { CreateShiftDto, UpdateShiftDto } from './dto/shift.dto.js'
import { CreateShiftDemandDto, UpdateShiftDemandDto } from './dto/shift-demand.dto.js'
import { CreateShiftTemplateDto, UpdateShiftTemplateDto } from './dto/shift-template.dto.js'
import { SolveGrafikDto } from './dto/solve.dto.js'

/** Any scheduling staff role may read the grafik; a PRACOWNIK reads their OWN shifts (scoped in the service). */
const READ_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK] as const
/** Shift mutations: MANAGER allowed but unit-scoped in the service; HR/ADMIN global. */
const SHIFT_WRITE_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA] as const
/** Demand/template mutations: catalog with no unit dimension → HR/ADMIN only. */
const CATALOG_WRITE_ROLES = [Role.HR, Role.ADMIN_KLIENTA] as const

/**
 * Rdzeń Grafiku CRUD API for `Shift`, `ShiftDemand`, `ShiftTemplate`.
 *
 * `@TenantRoute()` (class-level) binds the full tenant pipeline — KeycloakJwtGuard + RbacGuard +
 * TenantContextInterceptor + AuditInterceptor — so every route is authenticated, tenant-scoped,
 * and HTTP-audited. `@Roles(...)` per method sets the coarse role gate; row-level unit scoping for
 * shifts is enforced in GrafikService.
 *
 * NO `POST /grafik/solve` here — the optimizer packing endpoint is M2-A4.
 */
@Controller('grafik')
@TenantRoute()
export class GrafikController {
  constructor(private readonly grafik: GrafikService) {}

  private actor(user: JwtPayload, ip: string): GrafikActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  // --- Solve -------------------------------------------------------------------------------------

  /**
   * Pack the week × scope, call the optimizer, and persist the assignments as `Shift(source=AUTO)`.
   * Shift-writer roles (MANAGER/HR/ADMIN); a MANAGER is unit-scoped in the service. INFEASIBLE
   * returns `status` + `unmet[]` without persisting.
   */
  @Post('solve')
  @Roles(...SHIFT_WRITE_ROLES)
  async solve(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: SolveGrafikDto,
  ): Promise<SolveGrafikResult> {
    return this.grafik.solveGrafik(client, this.actor(user, ip), dto)
  }

  // --- Shift -------------------------------------------------------------------------------------

  @Get('shifts')
  @Roles(...READ_ROLES)
  async listShifts(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown[]> {
    return this.grafik.listShifts(client, this.actor(user, ip))
  }

  @Get('shifts/:id')
  @Roles(...READ_ROLES)
  async getShift(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.grafik.getShift(client, this.actor(user, ip), id)
  }

  @Get('lokalizacje')
  @Roles(...READ_ROLES)
  async listLokalizacje(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return this.grafik.listLokalizacje(client)
  }

  @Get('units')
  @Roles(...READ_ROLES)
  async listUnits(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return this.grafik.listUnits(client)
  }

  @Post('shifts')
  @Roles(...SHIFT_WRITE_ROLES)
  async createShift(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: CreateShiftDto,
  ): Promise<unknown> {
    return this.grafik.createShift(client, this.actor(user, ip), dto)
  }

  @Patch('shifts/:id')
  @Roles(...SHIFT_WRITE_ROLES)
  async updateShift(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
  ): Promise<unknown> {
    return this.grafik.updateShift(client, this.actor(user, ip), id, dto)
  }

  @Delete('shifts/:id')
  @Roles(...SHIFT_WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async deleteShift(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.grafik.deleteShift(client, this.actor(user, ip), id)
  }

  // --- ShiftDemand -------------------------------------------------------------------------------

  @Get('demands')
  @Roles(...READ_ROLES)
  async listDemands(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown[]> {
    return this.grafik.listDemands(client, this.actor(user, ip))
  }

  @Get('demands/:id')
  @Roles(...READ_ROLES)
  async getDemand(@CurrentTenantClient() client: TenantClient, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.grafik.getDemand(client, id)
  }

  @Post('demands')
  @Roles(...CATALOG_WRITE_ROLES)
  async createDemand(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: CreateShiftDemandDto,
  ): Promise<unknown> {
    return this.grafik.createDemand(client, this.actor(user, ip), dto)
  }

  @Patch('demands/:id')
  @Roles(...CATALOG_WRITE_ROLES)
  async updateDemand(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDemandDto,
  ): Promise<unknown> {
    return this.grafik.updateDemand(client, this.actor(user, ip), id, dto)
  }

  @Delete('demands/:id')
  @Roles(...CATALOG_WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async deleteDemand(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.grafik.deleteDemand(client, this.actor(user, ip), id)
  }

  // --- ShiftTemplate -----------------------------------------------------------------------------

  @Get('templates')
  @Roles(...READ_ROLES)
  async listTemplates(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return this.grafik.listTemplates(client)
  }

  @Get('templates/:id')
  @Roles(...READ_ROLES)
  async getTemplate(@CurrentTenantClient() client: TenantClient, @Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.grafik.getTemplate(client, id)
  }

  @Post('templates')
  @Roles(...CATALOG_WRITE_ROLES)
  async createTemplate(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: CreateShiftTemplateDto,
  ): Promise<unknown> {
    return this.grafik.createTemplate(client, this.actor(user, ip), dto)
  }

  @Patch('templates/:id')
  @Roles(...CATALOG_WRITE_ROLES)
  async updateTemplate(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftTemplateDto,
  ): Promise<unknown> {
    return this.grafik.updateTemplate(client, this.actor(user, ip), id, dto)
  }

  @Delete('templates/:id')
  @Roles(...CATALOG_WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  async deleteTemplate(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.grafik.deleteTemplate(client, this.actor(user, ip), id)
  }
}
