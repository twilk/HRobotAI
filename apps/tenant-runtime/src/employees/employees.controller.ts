import { Controller, Get, Ip } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { EmployeesService, type EmployeeActor } from './employees.service.js'

/** Any scheduling staff role may read the roster; a PRACOWNIK reads their OWN unit (scoped in the service). */
const READ_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK] as const

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
}
