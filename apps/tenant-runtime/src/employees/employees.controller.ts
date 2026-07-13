import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentTenantId, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { EmployeesService, type EmployeeActor } from './employees.service.js'
import { UpdateEmployeeDto } from './dto/employee.dto.js'

/** Any scheduling staff role may read the roster; a PRACOWNIK reads their OWN unit (scoped in the service). */
const READ_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK] as const
/** Only HR/ADMIN may edit an employee record (enforced again, defense-in-depth, in EmployeesService.update). */
const WRITE_ROLES = [Role.HR, Role.ADMIN_KLIENTA] as const

@Controller('employees')
@TenantRoute()
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  private actor(user: JwtPayload, ip: string): EmployeeActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  // RODO: PESEL projection is enforced in EmployeesService.list (SAFE_SELECT) — never re-add pesel/peselHash here
  @Get()
  @Roles(...READ_ROLES)
  async findAll(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown[]> {
    return this.employees.list(client, this.actor(user, ip))
  }

  // RODO: PESEL projection is enforced in EmployeesService.getById (SAFE_SELECT + peselLast4 masking) — never re-add pesel/peselHash here
  @Get(':id')
  @Roles(...READ_ROLES)
  async findOne(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.employees.getById(client, this.actor(user, ip), id, tenantId)
  }

  // RBAC: HR/ADMIN only — re-checked (defense-in-depth) in EmployeesService.update.
  @Patch(':id')
  @Roles(...WRITE_ROLES)
  async update(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<unknown> {
    return this.employees.update(client, this.actor(user, ip), id, dto, tenantId)
  }
}
