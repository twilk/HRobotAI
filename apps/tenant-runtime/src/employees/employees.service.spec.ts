import { Test, TestingModule } from '@nestjs/testing'
import { ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { EmployeesService, type EmployeeActor, PESEL_BI_KEY } from './employees.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { EncryptionService } from '@hrobot/shared'

/** A mock tenant client exposing exactly the delegates EmployeesService touches. */
function makeClient() {
  return {
    employee: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
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
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock }
  let client: MockClient

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    encryption = { encrypt: jest.fn(), decrypt: jest.fn() }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: AuditService, useValue: audit },
        { provide: EncryptionService, useValue: encryption },
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

  describe('getById', () => {
    it('lets a global actor (HR) read any profile by id', async () => {
      client.employee.findUnique.mockResolvedValue({
        id: 'e1',
        firstName: 'Anna',
        lastName: 'Kowalska',
        position: 'Kasjer',
        employmentType: 'UOP',
        hiredAt: new Date('2020-01-01'),
        unitId: 'u9',
        etat: 1,
        qualifications: [],
        pesel: 'CIPHER',
        peselHash: 'HASH',
        homeAddress: 'ENC-ADDR',
      })
      encryption.decrypt.mockReturnValue('44051401359')

      const profile = await service.getById(asClient(client), HR, 'e1', 'tenant-1')

      expect(profile.id).toBe('e1')
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when the employee does not exist', async () => {
      client.employee.findUnique.mockResolvedValue(null)

      await expect(service.getById(asClient(client), HR, 'ghost', 'tenant-1')).rejects.toThrow(NotFoundException)
    })

    it('throws ForbiddenException for a MANAGER reading an employee outside their managed unit(s)', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e2', unitId: 'other' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      await expect(service.getById(asClient(client), MANAGER, 'e2', 'tenant-1')).rejects.toThrow(ForbiddenException)
    })

    it('throws ForbiddenException for a PRACOWNIK reading an employee outside their own unit', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e3', unitId: 'other' })
      client.userRole.findMany.mockResolvedValue([])
      client.employee.findFirst.mockResolvedValue({ unitId: 'mine' })

      await expect(service.getById(asClient(client), PRACOWNIK, 'e3', 'tenant-1')).rejects.toThrow(ForbiddenException)
    })

    it('never returns pesel, peselHash or home-address fields, and includes peselLast4 only for a global actor', async () => {
      client.employee.findUnique.mockResolvedValue({
        id: 'e1',
        firstName: 'Anna',
        lastName: 'Kowalska',
        position: 'Kasjer',
        employmentType: 'UOP',
        hiredAt: new Date('2020-01-01'),
        unitId: 'u9',
        etat: 1,
        qualifications: [],
        pesel: 'CIPHER',
        peselHash: 'HASH',
        homeAddress: 'ENC-ADDR',
        homeLat: 52.1,
        homeLng: 21.0,
      })
      encryption.decrypt.mockReturnValue('44051401359')

      const profile = await service.getById(asClient(client), HR, 'e1', 'tenant-1')

      expect(profile.pesel).toBeUndefined()
      expect(profile.peselHash).toBeUndefined()
      expect(profile.homeAddress).toBeUndefined()
      expect(profile.homeLat).toBeUndefined()
      expect(profile.homeLng).toBeUndefined()
      expect(profile.peselLast4).toBe('1359')
    })

    it('still resolves (peselLast4 omitted) when decrypt throws for a global actor', async () => {
      client.employee.findUnique.mockResolvedValue({
        id: 'e1',
        firstName: 'Anna',
        lastName: 'Kowalska',
        position: 'Kasjer',
        employmentType: 'UOP',
        hiredAt: new Date('2020-01-01'),
        unitId: 'u9',
        etat: 1,
        qualifications: [],
        pesel: 'CORRUPT',
      })
      encryption.decrypt.mockImplementation(() => {
        throw new Error('DecryptionError: bad ciphertext')
      })

      const profile = await service.getById(asClient(client), HR, 'e1', 'tenant-1')

      expect(profile.id).toBe('e1')
      expect(profile.firstName).toBe('Anna')
      expect(profile.peselLast4).toBeUndefined()
      expect(profile.pesel).toBeUndefined()
    })

    it('does not include peselLast4 for a non-global in-scope reader', async () => {
      client.employee.findUnique.mockResolvedValue({
        id: 'e4',
        unitId: 'unit-A',
        pesel: 'CIPHER',
      })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      const profile = await service.getById(asClient(client), MANAGER, 'e4', 'tenant-1')

      expect(profile.id).toBe('e4')
      expect(profile.peselLast4).toBeUndefined()
      expect(encryption.decrypt).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('lets HR update fields and writes an audit entry', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u', position: 'old' })
      client.employee.update.mockResolvedValue({ id: 'e1', position: 'new' })

      await service.update(asClient(client), HR, 'e1', { position: 'new' }, 'tenant-1')

      expect(client.employee.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: expect.objectContaining({ position: 'new' }),
      })
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'employee.update' }),
      )
    })

    it('lets ADMIN_KLIENTA update fields', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u', position: 'old' })
      client.employee.update.mockResolvedValue({ id: 'e1', position: 'new' })

      await service.update(asClient(client), ADMIN, 'e1', { position: 'new' }, 'tenant-1')

      expect(client.employee.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: expect.objectContaining({ position: 'new' }),
      })
    })

    it('forbids a MANAGER from updating an employee (authz BEFORE any DB access)', async () => {
      await expect(
        service.update(asClient(client), MANAGER, 'e1', { position: 'new' }, 'tenant-1'),
      ).rejects.toThrow(ForbiddenException)
      expect(client.employee.findUnique).not.toHaveBeenCalled()
      expect(client.employee.update).not.toHaveBeenCalled()
    })

    it('forbids a PRACOWNIK from updating an employee (authz BEFORE any DB access)', async () => {
      await expect(
        service.update(asClient(client), PRACOWNIK, 'e1', { position: 'new' }, 'tenant-1'),
      ).rejects.toThrow(ForbiddenException)
      expect(client.employee.findUnique).not.toHaveBeenCalled()
      expect(client.employee.update).not.toHaveBeenCalled()
    })

    it('encrypts a new PESEL via employeePii and never audits it', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u', pesel: 'OLD-CIPHER', peselHash: 'OLD-HASH' })
      client.employee.update.mockResolvedValue({ id: 'e1', pesel: 'NEW-CIPHERTEXT', peselHash: 'NEW-HASH' })
      encryption.encrypt.mockReturnValue('NEW-CIPHERTEXT')

      const result = await service.update(asClient(client), ADMIN, 'e1', { pesel: '44051401359' }, 'tenant-1')

      const call = client.employee.update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(call.data.pesel).toBeDefined()
      expect(call.data.peselHash).toBeDefined()
      expect(call.data.pesel).not.toBe('44051401359')

      const auditPayload = JSON.stringify(audit.log.mock.calls[0][0])
      expect(auditPayload).not.toContain('44051401359')
      expect(auditPayload).not.toContain('NEW-CIPHERTEXT')

      // Return value is the SAFE_SELECT projection of the updated row — never any pesel/peselHash.
      const ret = result as Record<string, unknown>
      expect(ret.pesel).toBeUndefined()
      expect(ret.peselHash).toBeUndefined()
    })

    it('ALLOWLISTS the audit snapshots — home-address PII never reaches the append-only audit_log', async () => {
      // Raw rows carry home PII (homeAddress ciphertext + homeLat/homeLng). A blocklist scrub would
      // leak these; the SAFE_SELECT allowlist must drop them even on a change that only touches position.
      client.employee.findUnique.mockResolvedValue({
        id: 'e1', unitId: 'u', position: 'old',
        pesel: 'CIPHER', peselHash: 'HASH',
        homeAddress: 'ENC-HOME-ADDR', homeLat: 52.2297, homeLng: 21.0122,
      })
      client.employee.update.mockResolvedValue({
        id: 'e1', unitId: 'u', position: 'new',
        pesel: 'CIPHER', peselHash: 'HASH',
        homeAddress: 'ENC-HOME-ADDR', homeLat: 52.2297, homeLng: 21.0122,
      })

      await service.update(asClient(client), HR, 'e1', { position: 'new' }, 'tenant-1')

      const auditPayload = JSON.stringify(audit.log.mock.calls[0][0])
      expect(auditPayload).not.toContain('ENC-HOME-ADDR')
      expect(auditPayload).not.toContain('52.2297')
      expect(auditPayload).not.toContain('21.0122')
      expect(auditPayload).not.toContain('CIPHER')
      expect(auditPayload).not.toContain('HASH')
    })

    it('surfaces a Prisma P2002 (duplicate PESEL) as ConflictException', async () => {
      client.employee.findUnique.mockResolvedValue({ id: 'e1', unitId: 'u', peselHash: 'OLD-HASH' })
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      client.employee.update.mockRejectedValue(p2002)
      encryption.encrypt.mockReturnValue('NEW-CIPHERTEXT')

      await expect(
        service.update(asClient(client), ADMIN, 'e1', { pesel: '44051401359' }, 'tenant-1'),
      ).rejects.toThrow(ConflictException)
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when the employee does not exist', async () => {
      client.employee.findUnique.mockResolvedValue(null)

      await expect(
        service.update(asClient(client), HR, 'ghost', { position: 'new' }, 'tenant-1'),
      ).rejects.toThrow(NotFoundException)
      expect(client.employee.update).not.toHaveBeenCalled()
    })
  })

  describe('create', () => {
    const createDto = {
      firstName: 'Anna',
      lastName: 'Kowalska',
      position: 'Kasjer',
      employmentType: 'UMOWA_O_PRACE',
      unitId: 'unit-A',
      pesel: '44051401359',
      hiredAt: '2024-01-15',
    }

    it('lets HR create an employee, encrypting the PESEL and returning the SAFE_SELECT projection', async () => {
      encryption.encrypt.mockReturnValue('NEW-CIPHERTEXT')
      client.employee.create.mockResolvedValue({
        id: 'new-id',
        firstName: 'Anna',
        lastName: 'Kowalska',
        position: 'Kasjer',
        employmentType: 'UMOWA_O_PRACE',
        hiredAt: new Date('2024-01-15'),
        unitId: 'unit-A',
        etat: 1,
        qualifications: [],
        pesel: 'NEW-CIPHERTEXT',
        peselHash: 'NEW-HASH',
      })

      const result = await service.create(asClient(client), HR, createDto as never, 'tenant-1')

      const call = client.employee.create.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(call.data.pesel).toBeDefined()
      expect(call.data.pesel).not.toBe('44051401359')
      expect(call.data.peselHash).toBeDefined()
      expect(call.data.userId).toBeNull()
      expect(call.data.hiredAt).toBeInstanceOf(Date)

      const ret = result as Record<string, unknown>
      expect(ret.id).toBe('new-id')
      expect(ret.pesel).toBeUndefined()
      expect(ret.peselHash).toBeUndefined()
      expect((ret as Record<string, unknown>).homeAddress).toBeUndefined()

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'employee.create' }),
      )
      const auditPayload = JSON.stringify(audit.log.mock.calls[0][0])
      expect(auditPayload).not.toContain('44051401359')
      expect(auditPayload).not.toContain('NEW-CIPHERTEXT')
    })

    it('lets ADMIN_KLIENTA create an employee', async () => {
      encryption.encrypt.mockReturnValue('NEW-CIPHERTEXT')
      client.employee.create.mockResolvedValue({ id: 'new-id-2', unitId: 'unit-A' })

      await service.create(asClient(client), ADMIN, createDto as never, 'tenant-1')

      expect(client.employee.create).toHaveBeenCalled()
    })

    it('forbids a MANAGER from creating an employee (authz BEFORE any encryption/DB access)', async () => {
      await expect(
        service.create(asClient(client), MANAGER, createDto as never, 'tenant-1'),
      ).rejects.toThrow(ForbiddenException)
      expect(encryption.encrypt).not.toHaveBeenCalled()
      expect(client.employee.create).not.toHaveBeenCalled()
    })

    it('forbids a PRACOWNIK from creating an employee (authz BEFORE any encryption/DB access)', async () => {
      await expect(
        service.create(asClient(client), PRACOWNIK, createDto as never, 'tenant-1'),
      ).rejects.toThrow(ForbiddenException)
      expect(encryption.encrypt).not.toHaveBeenCalled()
      expect(client.employee.create).not.toHaveBeenCalled()
    })

    it('surfaces a Prisma P2002 (duplicate PESEL) as ConflictException', async () => {
      encryption.encrypt.mockReturnValue('NEW-CIPHERTEXT')
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      client.employee.create.mockRejectedValue(p2002)

      await expect(
        service.create(asClient(client), HR, createDto as never, 'tenant-1'),
      ).rejects.toThrow(ConflictException)
      expect(audit.log).not.toHaveBeenCalled()
    })
  })
})
