import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { AccessStatus, AccessType, Role } from '@hrobot/shared'
import { AccessService, type AccessActor } from './dostepy.service.js'
import type { AuditService } from '../tenant-runtime/audit/audit.service.js'

const HR: AccessActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const ADMIN: AccessActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.2' }
const MANAGER: AccessActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.3' }

/** A mock tenant client exposing exactly the delegates AccessService touches. */
function makeClient() {
  return {
    accessGrant: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    employee: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    userRole: { findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const issueDto = {
  employeeId: 'emp-x',
  type: AccessType.CARD,
  label: 'Karta wejściowa',
  identifier: 'CARD-7788',
} as const

describe('AccessService', () => {
  let service: AccessService
  let audit: { log: jest.Mock }
  let client: MockClient

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    service = new AccessService(audit as unknown as AuditService)
    client = makeClient()
    jest.clearAllMocks()
  })

  describe('issue', () => {
    it('lets HR issue a grant, resolving issuedByUserId from keycloakSub and creating it ACTIVE', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-A' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.accessGrant.create.mockResolvedValue({ id: 'ag-1', employeeId: 'emp-x', type: AccessType.CARD, status: AccessStatus.ACTIVE, lokalizacjaId: null })

      const result = await service.issue(asClient(client), HR, { ...issueDto })

      const arg = client.accessGrant.create.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data.status).toBe(AccessStatus.ACTIVE)
      expect(arg.data.issuedByUserId).toBe('user-hr')
      expect(arg.data.employeeId).toBe('emp-x')
      expect(result).toEqual({ id: 'ag-1', employeeId: 'emp-x', type: AccessType.CARD, status: AccessStatus.ACTIVE, lokalizacjaId: null })
    })

    it('lets a MANAGER issue a grant to an employee in their managed unit', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-A' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.user.findFirst.mockResolvedValue({ id: 'user-mgr' })
      client.accessGrant.create.mockResolvedValue({ id: 'ag-2', employeeId: 'emp-x', status: AccessStatus.ACTIVE })

      await service.issue(asClient(client), MANAGER, { ...issueDto })
      expect(client.accessGrant.create).toHaveBeenCalled()
    })

    it('forbids an out-of-unit MANAGER from issuing (target employee outside managed units) → 403', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'other-unit' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      await expect(service.issue(asClient(client), MANAGER, { ...issueDto })).rejects.toThrow(ForbiddenException)
      expect(client.accessGrant.create).not.toHaveBeenCalled()
    })

    it('maps a duplicate ACTIVE (type, identifier) P2002 to a 409 ConflictException', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-A' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.accessGrant.create.mockRejectedValue({ code: 'P2002' })

      await expect(service.issue(asClient(client), HR, { ...issueDto })).rejects.toThrow(ConflictException)
    })

    it('maps a bad employee/lokalizacja FK P2003 to a 400 BadRequestException', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-A' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.accessGrant.create.mockRejectedValue({ code: 'P2003' })

      await expect(service.issue(asClient(client), HR, { ...issueDto })).rejects.toThrow(BadRequestException)
    })

    it('NEVER writes the sensitive identifier into the audit payload', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-A' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.accessGrant.create.mockResolvedValue({ id: 'ag-1', employeeId: 'emp-x', type: AccessType.CARD, status: AccessStatus.ACTIVE, lokalizacjaId: null })

      await service.issue(asClient(client), HR, { ...issueDto })

      const auditArg = audit.log.mock.calls[0][0] as { action: string; payload: Record<string, unknown> }
      expect(auditArg.action).toBe('access.issued')
      expect(JSON.stringify(auditArg.payload)).not.toContain('CARD-7788')
      expect(auditArg.payload.identifier).toBeUndefined()
      expect(auditArg.payload.employeeId).toBe('emp-x')
    })
  })

  describe('revoke', () => {
    const activeGrant = { id: 'ag-1', employeeId: 'emp-x', status: AccessStatus.ACTIVE, notes: null, employee: { id: 'emp-x', firstName: 'Anna', lastName: 'Kowalska', unitId: 'unit-A' } }

    it('flips an ACTIVE grant to REVOKED under an optimistic lock and audits (HR)', async () => {
      client.accessGrant.findUnique.mockResolvedValue({ ...activeGrant })
      client.accessGrant.updateMany.mockResolvedValue({ count: 1 })
      client.accessGrant.findUniqueOrThrow.mockResolvedValue({ id: 'ag-1', status: AccessStatus.REVOKED })

      const result = await service.revoke(asClient(client), HR, 'ag-1', { reason: 'zgubiona' })

      const arg = client.accessGrant.updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
      expect(arg.where).toEqual({ id: 'ag-1', status: AccessStatus.ACTIVE })
      expect(arg.data.status).toBe(AccessStatus.REVOKED)
      expect(arg.data.revokedAt).toBeInstanceOf(Date)
      expect(arg.data.notes).toContain('zgubiona')
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access.revoked' }))
      expect(result).toEqual({ id: 'ag-1', status: AccessStatus.REVOKED })
    })

    it('throws NotFoundException for an unknown id', async () => {
      client.accessGrant.findUnique.mockResolvedValue(null)
      await expect(service.revoke(asClient(client), HR, 'ghost', {})).rejects.toThrow(NotFoundException)
    })

    it('throws ConflictException when the grant is not ACTIVE', async () => {
      client.accessGrant.findUnique.mockResolvedValue({ ...activeGrant, status: AccessStatus.REVOKED })
      await expect(service.revoke(asClient(client), HR, 'ag-1', {})).rejects.toThrow(ConflictException)
      expect(client.accessGrant.updateMany).not.toHaveBeenCalled()
    })

    it('throws ConflictException on an optimistic-lock miss (updateMany count 0)', async () => {
      client.accessGrant.findUnique.mockResolvedValue({ ...activeGrant })
      client.accessGrant.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.revoke(asClient(client), HR, 'ag-1', {})).rejects.toThrow(ConflictException)
    })

    it('forbids an out-of-unit MANAGER from revoking (grant employee outside managed units) → 403', async () => {
      client.accessGrant.findUnique.mockResolvedValue({ ...activeGrant, employee: { ...activeGrant.employee, unitId: 'other-unit' } })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      await expect(service.revoke(asClient(client), MANAGER, 'ag-1', {})).rejects.toThrow(ForbiddenException)
      expect(client.accessGrant.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('returns all grants for a global actor (ADMIN) without a scope where filter', async () => {
      client.accessGrant.findMany.mockResolvedValue([])
      await service.list(asClient(client), ADMIN)
      const arg = client.accessGrant.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
      expect(arg.where).toEqual({})
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })

    it('scopes a MANAGER to grants of employees in their managed unit(s)', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.accessGrant.findMany.mockResolvedValue([])
      await service.list(asClient(client), MANAGER, { status: AccessStatus.ACTIVE })
      const arg = client.accessGrant.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
      expect(arg.where).toEqual({ status: AccessStatus.ACTIVE, employee: { unitId: { in: ['unit-A'] } } })
    })

    it('projects the employee sub-object to a SAFE allowlist (no pesel/home)', async () => {
      client.accessGrant.findMany.mockResolvedValue([])
      await service.list(asClient(client), ADMIN)
      const arg = client.accessGrant.findMany.mock.calls[0][0] as { select: { employee: { select: Record<string, unknown> } } }
      const empSelect = arg.select.employee.select
      expect(empSelect).toEqual({ id: true, firstName: true, lastName: true, unitId: true })
      expect(empSelect.pesel).toBeUndefined()
      expect(empSelect.peselHash).toBeUndefined()
      expect(empSelect.homeAddress).toBeUndefined()
    })
  })

  describe('getById', () => {
    const grant = { id: 'ag-1', employeeId: 'emp-x', status: AccessStatus.ACTIVE, employee: { id: 'emp-x', firstName: 'Anna', lastName: 'Kowalska', unitId: 'unit-A' } }

    it('throws NotFoundException for an unknown id', async () => {
      client.accessGrant.findUnique.mockResolvedValue(null)
      await expect(service.getById(asClient(client), HR, 'ghost')).rejects.toThrow(NotFoundException)
    })

    it('lets a global actor read any grant', async () => {
      client.accessGrant.findUnique.mockResolvedValue({ ...grant })
      expect(await service.getById(asClient(client), HR, 'ag-1')).toEqual(grant)
    })

    it('throws ForbiddenException for an out-of-scope grant (MANAGER, other unit)', async () => {
      client.accessGrant.findUnique.mockResolvedValue({ ...grant, employee: { ...grant.employee, unitId: 'other-unit' } })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      await expect(service.getById(asClient(client), MANAGER, 'ag-1')).rejects.toThrow(ForbiddenException)
    })
  })
})
