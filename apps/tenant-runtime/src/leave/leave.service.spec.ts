import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { LeaveStatus, Role } from '@hrobot/shared'
import { LeaveService, type LeaveActor } from './leave.service.js'
import type { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { ReplacementService } from '../ai-grafik/replacement.service.js'
import type { AiProposalService } from '../ai-grafik/ai-proposal.service.js'

const HR: LeaveActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const ADMIN: LeaveActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.2' }
const MANAGER: LeaveActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.3' }
const PRACOWNIK: LeaveActor = { userId: 'kc-emp', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.4' }

/** A mock tenant client exposing exactly the delegates LeaveService touches. */
function makeClient() {
  return {
    leaveRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    employee: { findFirst: jest.fn(), findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
    userRole: { findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

describe('LeaveService', () => {
  let service: LeaveService
  let audit: { log: jest.Mock }
  let replacement: { findVacatedShifts: jest.Mock }
  let proposals: { createReplacement: jest.Mock }
  let client: MockClient

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    replacement = { findVacatedShifts: jest.fn().mockResolvedValue([]) }
    proposals = { createReplacement: jest.fn().mockResolvedValue({ id: 'prop-1' }) }
    service = new LeaveService(
      audit as unknown as AuditService,
      replacement as unknown as ReplacementService,
      proposals as unknown as AiProposalService,
    )
    client = makeClient()
    jest.clearAllMocks()
  })

  describe('createRequest', () => {
    it('files against the caller OWN employee (PRACOWNIK) in the PENDING state, ignoring any dto.employeeId', async () => {
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
      client.leaveRequest.create.mockResolvedValue({ id: 'lv-1', employeeId: 'emp-self', status: LeaveStatus.PENDING })

      await service.createRequest(asClient(client), PRACOWNIK, {
        employeeId: 'someone-else',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        type: 'URLOP_WYPOCZYNKOWY',
      })

      const arg = client.leaveRequest.create.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data.employeeId).toBe('emp-self')
      expect(arg.data.status).toBe(LeaveStatus.PENDING)
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.created' }))
    })

    it('lets a GLOBAL actor (HR) file on behalf of another employee via dto.employeeId', async () => {
      client.leaveRequest.create.mockResolvedValue({ id: 'lv-2', employeeId: 'emp-x', status: LeaveStatus.PENDING })

      await service.createRequest(asClient(client), HR, {
        employeeId: 'emp-x',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        type: 'URLOP_NA_ZADANIE',
      })

      const arg = client.leaveRequest.create.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data.employeeId).toBe('emp-x')
      expect(client.employee.findFirst).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when a caller with no Employee record files for themselves', async () => {
      client.employee.findFirst.mockResolvedValue(null)
      await expect(
        service.createRequest(asClient(client), PRACOWNIK, { startDate: '2026-08-01', endDate: '2026-08-05', type: 'X' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('list scoping', () => {
    it('returns all requests for a global actor (HR) without a scope where filter', async () => {
      client.leaveRequest.findMany.mockResolvedValue([])
      await service.list(asClient(client), HR)
      const arg = client.leaveRequest.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
      expect(arg.where).toEqual({})
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })

    it('scopes a MANAGER to leave of employees in their managed unit(s)', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.leaveRequest.findMany.mockResolvedValue([])
      await service.list(asClient(client), MANAGER)
      expect(client.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employee: { unitId: { in: ['unit-A'] } } } }),
      )
    })

    it('scopes a plain PRACOWNIK to their OWN requests', async () => {
      client.userRole.findMany.mockResolvedValue([])
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
      client.leaveRequest.findMany.mockResolvedValue([])
      await service.list(asClient(client), PRACOWNIK)
      expect(client.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId: 'emp-self' } }),
      )
    })

    it('never selects the employee relation (RODO — no PII in a leave list)', async () => {
      client.leaveRequest.findMany.mockResolvedValue([])
      await service.list(asClient(client), HR)
      const arg = client.leaveRequest.findMany.mock.calls[0][0] as { select: Record<string, unknown> }
      expect(arg.select.employee).toBeUndefined()
      expect(arg.select.employeeId).toBe(true)
    })
  })

  describe('getById', () => {
    it('throws NotFoundException for an unknown id', async () => {
      client.leaveRequest.findUnique.mockResolvedValue(null)
      await expect(service.getById(asClient(client), HR, 'ghost')).rejects.toThrow(NotFoundException)
    })

    it('lets a global actor read any request', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ id: 'lv-1', employeeId: 'emp-x' })
      const leave = await service.getById(asClient(client), HR, 'lv-1')
      expect(leave).toEqual({ id: 'lv-1', employeeId: 'emp-x' })
    })

    it('throws ForbiddenException for an out-of-scope request (MANAGER, other unit)', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ id: 'lv-1', employeeId: 'emp-x' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.employee.findUnique.mockResolvedValue({ unitId: 'other-unit' })
      await expect(service.getById(asClient(client), MANAGER, 'lv-1')).rejects.toThrow(ForbiddenException)
    })

    it('throws ForbiddenException for a PRACOWNIK reading a request that is not their own', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ id: 'lv-1', employeeId: 'emp-x' })
      client.userRole.findMany.mockResolvedValue([])
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
      await expect(service.getById(asClient(client), PRACOWNIK, 'lv-1')).rejects.toThrow(ForbiddenException)
    })
  })

  describe('decide', () => {
    const pendingLeave = { id: 'lv-1', employeeId: 'emp-x', status: LeaveStatus.PENDING, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-05') }

    it('lets HR approve a pending request (optimistic lock + audit), resolving decidedByUserId from keycloakSub', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-hr' }) // maker != leave employee
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.leaveRequest.updateMany.mockResolvedValue({ count: 1 })
      client.leaveRequest.findUniqueOrThrow.mockResolvedValue({ id: 'lv-1', status: LeaveStatus.APPROVED })

      const result = await service.decide(asClient(client), HR, 'lv-1', { approve: true })

      const arg = client.leaveRequest.updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
      expect(arg.where).toEqual({ id: 'lv-1', status: LeaveStatus.PENDING })
      expect(arg.data.status).toBe(LeaveStatus.APPROVED)
      expect(arg.data.decidedByUserId).toBe('user-hr')
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.approved' }))
      expect(result).toEqual({ id: 'lv-1', status: LeaveStatus.APPROVED })
    })

    it('records a reject decision with the leave.rejected audit action', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-hr' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.leaveRequest.updateMany.mockResolvedValue({ count: 1 })
      client.leaveRequest.findUniqueOrThrow.mockResolvedValue({ id: 'lv-1', status: LeaveStatus.REJECTED })

      await service.decide(asClient(client), HR, 'lv-1', { approve: false, reason: 'brak zastępstwa' })

      const arg = client.leaveRequest.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data.status).toBe(LeaveStatus.REJECTED)
      expect(arg.data.reason).toBe('brak zastępstwa')
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.rejected' }))
      expect(replacement.findVacatedShifts).not.toHaveBeenCalled() // no auto-scan on reject
    })

    it('forbids a MANAGER from deciding a request whose employee is outside their managed unit(s)', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.employee.findUnique.mockResolvedValue({ unitId: 'other-unit' })

      await expect(service.decide(asClient(client), MANAGER, 'lv-1', { approve: true })).rejects.toThrow(ForbiddenException)
      expect(client.leaveRequest.updateMany).not.toHaveBeenCalled()
    })

    it('forbids self-approval even for HR/ADMIN (maker-checker): actor employee == leave employee → 403', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave, employeeId: 'emp-self' })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })

      await expect(service.decide(asClient(client), ADMIN, 'lv-1', { approve: true })).rejects.toThrow(ForbiddenException)
      expect(client.leaveRequest.updateMany).not.toHaveBeenCalled()
    })

    it('throws ConflictException on an optimistic-lock miss (updateMany count 0)', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-hr' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.leaveRequest.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.decide(asClient(client), HR, 'lv-1', { approve: true })).rejects.toThrow(ConflictException)
    })

    it('throws ConflictException when the request is not pending', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave, status: LeaveStatus.APPROVED })

      await expect(service.decide(asClient(client), HR, 'lv-1', { approve: true })).rejects.toThrow(ConflictException)
      expect(client.leaveRequest.updateMany).not.toHaveBeenCalled()
    })

    it('AUTO-SCAN: an approve creates a replacement proposal for each colliding shift of the approved employee', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-hr' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.leaveRequest.updateMany.mockResolvedValue({ count: 1 })
      client.leaveRequest.findUniqueOrThrow.mockResolvedValue({ id: 'lv-1', status: LeaveStatus.APPROVED })
      replacement.findVacatedShifts.mockResolvedValue([
        { id: 'shift-1', employeeId: 'emp-x' },
        { id: 'shift-2', employeeId: 'emp-other' }, // different employee — must be ignored
      ])

      await service.decide(asClient(client), HR, 'lv-1', { approve: true })

      expect(replacement.findVacatedShifts).toHaveBeenCalledWith(
        asClient(client),
        expect.objectContaining({ userId: 'kc-hr' }),
        { from: '2026-08-01', to: '2026-08-05' },
      )
      expect(proposals.createReplacement).toHaveBeenCalledTimes(1)
      expect(proposals.createReplacement).toHaveBeenCalledWith(asClient(client), expect.anything(), 'shift-1', expect.any(String))
    })

    it('AUTO-SCAN failure never fails the approve (best-effort tie-in)', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-hr' })
      client.user.findFirst.mockResolvedValue({ id: 'user-hr' })
      client.leaveRequest.updateMany.mockResolvedValue({ count: 1 })
      client.leaveRequest.findUniqueOrThrow.mockResolvedValue({ id: 'lv-1', status: LeaveStatus.APPROVED })
      replacement.findVacatedShifts.mockRejectedValue(new Error('scan boom'))

      const result = await service.decide(asClient(client), HR, 'lv-1', { approve: true })
      expect(result).toEqual({ id: 'lv-1', status: LeaveStatus.APPROVED })
    })
  })

  describe('cancel', () => {
    const pendingLeave = { id: 'lv-1', employeeId: 'emp-self', status: LeaveStatus.PENDING, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-05') }

    it('lets the requester cancel their own pending request', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
      client.leaveRequest.updateMany.mockResolvedValue({ count: 1 })
      client.leaveRequest.findUniqueOrThrow.mockResolvedValue({ id: 'lv-1', status: LeaveStatus.CANCELLED })

      await service.cancel(asClient(client), PRACOWNIK, 'lv-1')

      const arg = client.leaveRequest.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data.status).toBe(LeaveStatus.CANCELLED)
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'leave.cancelled' }))
    })

    it('forbids cancelling someone else request', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave, employeeId: 'emp-other' })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
      await expect(service.cancel(asClient(client), PRACOWNIK, 'lv-1')).rejects.toThrow(ForbiddenException)
      expect(client.leaveRequest.updateMany).not.toHaveBeenCalled()
    })

    it('throws ConflictException when cancelling a non-pending request', async () => {
      client.leaveRequest.findUnique.mockResolvedValue({ ...pendingLeave, status: LeaveStatus.APPROVED })
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
      await expect(service.cancel(asClient(client), PRACOWNIK, 'lv-1')).rejects.toThrow(ConflictException)
    })
  })
})
