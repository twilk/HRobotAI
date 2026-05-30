import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { EmployeesController } from './employees.controller.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { TenantClient } from '@hrobot/db'

const mockEmployees = [
  { id: 'emp-1', firstName: 'Jan', lastName: 'Kowalski', position: 'Developer', employmentType: 'UMOWA_O_PRACE', hiredAt: new Date('2024-01-15'), unitId: 'unit-1' },
]
const mockTenantClient = { employee: { findMany: jest.fn() } } as unknown as TenantClient

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('EmployeesController', () => {
  let controller: EmployeesController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeesController],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(EmployeesController)
    jest.clearAllMocks()
  })

  it('returns employees from the tenant DB', async () => {
    (mockTenantClient.employee.findMany as jest.Mock).mockResolvedValue(mockEmployees)
    expect(await controller.findAll(mockTenantClient)).toEqual(mockEmployees)
    expect(mockTenantClient.employee.findMany).toHaveBeenCalledWith({
      orderBy: { hiredAt: 'desc' },
      select: { id: true, firstName: true, lastName: true, position: true, employmentType: true, hiredAt: true, unitId: true },
    })
  })

  it('returns empty array when no employees exist', async () => {
    (mockTenantClient.employee.findMany as jest.Mock).mockResolvedValue([])
    expect(await controller.findAll(mockTenantClient)).toEqual([])
  })
})
