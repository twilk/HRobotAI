import { Test, TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { EmployeesService, type EmployeeActor, PESEL_BI_KEY } from './employees.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { EncryptionService } from '@hrobot/shared'

/** A mock tenant client exposing exactly the delegates EmployeesService touches. */
function makeClient() {
  return {
    employee: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    userRole: { findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const HR: EmployeeActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const ADMIN: EmployeeActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.2' }
const MANAGER: EmployeeActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.3' }
const PRACOWNIK: EmployeeActor = { userId: 'kc-emp', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.4' }

describe('EmployeesService', () => {
  let service: EmployeesService
  let audit: { log: jest.Mock }
  let client: MockClient

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: AuditService, useValue: audit },
        { provide: EncryptionService, useValue: {} },
        { provide: PESEL_BI_KEY, useValue: Buffer.alloc(32) },
      ],
    }).compile()
    service = module.get(EmployeesService)
    client = makeClient()
    jest.clearAllMocks()
  })

  describe('list scoping', () => {
    it('returns all employees for a global actor (HR) without a unit where filter', async () => {
      client.employee.findMany.mockResolvedValue([])
      await service.list(asClient(client), HR)
      expect(client.employee.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      )
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })

    it('returns all employees for a global actor (ADMIN_KLIENTA) without a unit where filter', async () => {
      client.employee.findMany.mockResolvedValue([])
      await service.list(asClient(client), ADMIN)
      expect(client.employee.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      )
    })

    it('scopes a MANAGER to their managed unit(s)', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.employee.findMany.mockResolvedValue([])

      await service.list(asClient(client), MANAGER)

      expect(client.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { unitId: { in: ['unit-A'] } } }),
      )
    })

    it("scopes a plain PRACOWNIK to their own unit (resolved via their Employee record)", async () => {
      client.userRole.findMany.mockResolvedValue([]) // manages nothing
      client.employee.findFirst.mockResolvedValue({ unitId: 'unit-B' })
      client.employee.findMany.mockResolvedValue([])

      await service.list(asClient(client), PRACOWNIK)

      expect(client.employee.findFirst).toHaveBeenCalledWith({
        where: { user: { keycloakSub: 'kc-emp' } },
        select: { unitId: true },
      })
      expect(client.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { unitId: { in: ['unit-B'] } } }),
      )
    })

    it('fails safe to an empty roster when a PRACOWNIK manages no unit AND has no own unit', async () => {
      client.userRole.findMany.mockResolvedValue([]) // manages nothing
      client.employee.findFirst.mockResolvedValue(null) // no own Employee record → null unit
      client.employee.findMany.mockResolvedValue([])

      await service.list(asClient(client), PRACOWNIK)

      // Prisma `in: []` matches zero rows → empty roster, NOT an unscoped all-rows bypass.
      expect(client.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { unitId: { in: [] } } }),
      )
    })
  })

  describe('RODO — PESEL must never be selected', () => {
    it.each([
      ['HR', HR],
      ['ADMIN_KLIENTA', ADMIN],
      ['MANAGER', MANAGER],
      ['PRACOWNIK', PRACOWNIK],
    ])('excludes pesel and peselHash from the select for %s', async (_label, actor) => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.employee.findFirst.mockResolvedValue({ unitId: 'unit-B' })
      client.employee.findMany.mockResolvedValue([])

      await service.list(asClient(client), actor)

      const arg = client.employee.findMany.mock.calls[0][0] as { select: Record<string, unknown> }
      expect(arg.select).toBeDefined()
      expect(arg.select.pesel).toBeUndefined()
      expect(arg.select.peselHash).toBeUndefined()
    })
  })
})
