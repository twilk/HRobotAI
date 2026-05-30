import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import { CurrentTenantClient } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'

@Controller('employees')
@UseGuards(KeycloakJwtGuard, RbacGuard)
@UseInterceptors(TenantContextInterceptor)
export class EmployeesController {
  /** pesel is NEVER selected — RODO PII, must never appear in API responses. */
  @Get()
  async findAll(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return client.employee.findMany({
      orderBy: { hiredAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        employmentType: true,
        hiredAt: true,
        unitId: true,
      },
    })
  }
}
