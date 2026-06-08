import { Controller, Get } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { CurrentTenantClient } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'

@Controller('employees')
@TenantRoute()
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
