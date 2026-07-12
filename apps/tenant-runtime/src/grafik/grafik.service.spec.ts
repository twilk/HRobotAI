import { Test, TestingModule } from '@nestjs/testing'
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role, SolveStatus } from '@hrobot/shared'
import { GrafikService, GrafikActor } from './grafik.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { OPTIMIZER_CLIENT, type OptimizerClient } from './optimizer.client.js'

/** A mock tenant client exposing exactly the delegates GrafikService touches. */
function makeClient() {
  return {
    shift: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    shiftDemand: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    shiftTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    leaveRequest: { findMany: jest.fn() },
    lokalizacja: { findMany: jest.fn() },
    userRole: { findMany: jest.fn() },
    $transaction: jest.fn(),
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const MANAGER: GrafikActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.1' }
const HR: GrafikActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.2' }
const ADMIN: GrafikActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.3' }
const PRACOWNIK: GrafikActor = { userId: 'kc-emp', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.4' }

describe('GrafikService', () => {
  let service: GrafikService
  let audit: { log: jest.Mock }
  let optimizer: { solve: jest.Mock }
  let client: MockClient

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    optimizer = { solve: jest.fn() }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrafikService,
        { provide: AuditService, useValue: audit },
        { provide: OPTIMIZER_CLIENT, useValue: optimizer as OptimizerClient },
      ],
    }).compile()
    service = module.get(GrafikService)
    client = makeClient()
    jest.clearAllMocks()
  })

  // --- Shift RBAC (unit scoping) ---------------------------------------------------------------

  describe('Shift RBAC', () => {
    it('lets a MANAGER create a shift for an employee in their own unit', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-A' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.shift.create.mockResolvedValue({ id: 'shift-1' })

      const dto = { employeeId: 'emp-1', lokalizacjaId: 'loc-1', date: '2026-07-13', start: '08:00', end: '16:00', role: 'NURSE' }
      const result = await service.createShift(asClient(client), MANAGER, dto)

      expect(result).toEqual({ id: 'shift-1' })
      expect(client.shift.create).toHaveBeenCalledTimes(1)
    })

    it("forbids a MANAGER creating a shift for another unit's employee", async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-B' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      const dto = { employeeId: 'emp-9', lokalizacjaId: 'loc-1', date: '2026-07-13', start: '08:00', end: '16:00', role: 'NURSE' }
      await expect(service.createShift(asClient(client), MANAGER, dto)).rejects.toBeInstanceOf(ForbiddenException)
      expect(client.shift.create).not.toHaveBeenCalled()
    })

    it("forbids a MANAGER updating another unit's shift", async () => {
      client.shift.findUnique.mockResolvedValue({ id: 'shift-1', employeeId: 'emp-9' })
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-B' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      await expect(service.updateShift(asClient(client), MANAGER, 'shift-1', { role: 'DOCTOR' })).rejects.toBeInstanceOf(
        ForbiddenException,
      )
      expect(client.shift.update).not.toHaveBeenCalled()
    })

    it("forbids a MANAGER deleting another unit's shift", async () => {
      client.shift.findUnique.mockResolvedValue({ id: 'shift-1', employeeId: 'emp-9' })
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-B' })
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      await expect(service.deleteShift(asClient(client), MANAGER, 'shift-1')).rejects.toBeInstanceOf(ForbiddenException)
      expect(client.shift.delete).not.toHaveBeenCalled()
    })

    it('lets HR create a shift globally without a unit lookup', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-Z' })
      client.shift.create.mockResolvedValue({ id: 'shift-2' })

      const dto = { employeeId: 'emp-2', lokalizacjaId: 'loc-1', date: '2026-07-13', start: '08:00', end: '16:00', role: 'NURSE' }
      await service.createShift(asClient(client), HR, dto)

      expect(client.userRole.findMany).not.toHaveBeenCalled() // global → no scoping query
      expect(client.shift.create).toHaveBeenCalledTimes(1)
    })

    it('scopes MANAGER list to managed units; HR lists all', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.shift.findMany.mockResolvedValue([])

      await service.listShifts(asClient(client), MANAGER)
      expect(client.shift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employee: { unitId: { in: ['unit-A'] } } } }),
      )

      client.shift.findMany.mockClear()
      await service.listShifts(asClient(client), HR)
      expect(client.shift.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ where: expect.anything() }))
    })

    it('scopes a plain PRACOWNIK list to their own shifts (no managed units)', async () => {
      client.userRole.findMany.mockResolvedValue([]) // manages nothing
      client.shift.findMany.mockResolvedValue([])

      await service.listShifts(asClient(client), PRACOWNIK)
      expect(client.shift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employee: { user: { keycloakSub: 'kc-emp' } } } }),
      )
    })

    it('throws NotFound when the target employee does not exist', async () => {
      client.employee.findUnique.mockResolvedValue(null)
      const dto = { employeeId: 'ghost', lokalizacjaId: 'loc-1', date: '2026-07-13', start: '08:00', end: '16:00', role: 'NURSE' }
      await expect(service.createShift(asClient(client), HR, dto)).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  // --- Audit ------------------------------------------------------------------------------------

  describe('audit logging', () => {
    it('writes an entity-typed audit row with after-state on create', async () => {
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-Z' })
      client.shift.create.mockResolvedValue({ id: 'shift-3', role: 'NURSE' })

      const dto = { employeeId: 'emp-2', lokalizacjaId: 'loc-1', date: '2026-07-13', start: '08:00', end: '16:00', role: 'NURSE' }
      await service.createShift(asClient(client), ADMIN, dto)

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantClient: asClient(client),
          actorUserId: 'kc-admin',
          action: 'shift.create',
          entityType: 'Shift',
          entityId: 'shift-3',
          payload: { after: { id: 'shift-3', role: 'NURSE' } },
          ipAddress: '10.0.0.3',
        }),
      )
    })

    it('writes before/after on update', async () => {
      client.shift.findUnique.mockResolvedValue({ id: 'shift-3', employeeId: 'emp-2', role: 'NURSE' })
      client.employee.findUnique.mockResolvedValue({ unitId: 'unit-Z' })
      client.shift.update.mockResolvedValue({ id: 'shift-3', employeeId: 'emp-2', role: 'DOCTOR' })

      await service.updateShift(asClient(client), HR, 'shift-3', { role: 'DOCTOR' })

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'shift.update',
          entityType: 'Shift',
          payload: {
            before: { id: 'shift-3', employeeId: 'emp-2', role: 'NURSE' },
            after: { id: 'shift-3', employeeId: 'emp-2', role: 'DOCTOR' },
          },
        }),
      )
    })

    it('writes a before-state audit row on demand delete', async () => {
      client.shiftDemand.findUnique.mockResolvedValue({ id: 'dem-1', requiredCount: 2 })
      client.shiftDemand.delete.mockResolvedValue({ id: 'dem-1' })

      await service.deleteDemand(asClient(client), HR, 'dem-1')

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'shiftDemand.delete', entityType: 'ShiftDemand', payload: { before: { id: 'dem-1', requiredCount: 2 } } }),
      )
    })
  })

  // --- ShiftDemand / ShiftTemplate CRUD ---------------------------------------------------------

  describe('demand & template CRUD', () => {
    it('creates a demand and coerces date to a Date', async () => {
      client.shiftDemand.create.mockResolvedValue({ id: 'dem-2' })
      const dto = { lokalizacjaId: 'loc-1', date: '2026-07-13', start: '08:00', end: '16:00', requiredRole: 'NURSE', requiredCount: 3 }
      await service.createDemand(asClient(client), ADMIN, dto)

      const arg = client.shiftDemand.create.mock.calls[0][0] as { data: { date: Date } }
      expect(arg.data.date).toBeInstanceOf(Date)
      expect(arg.data.date.toISOString().slice(0, 10)).toBe('2026-07-13')
    })

    it('creates a template, passing okna through as JSON', async () => {
      client.shiftTemplate.create.mockResolvedValue({ id: 'tpl-1' })
      const okna = [{ start: '08:00', end: '16:00', rola: 'NURSE', liczba: 2 }]
      const dto = { lokalizacjaTyp: 'ODDZIAL', nazwa: 'Dzienna', dni: ['MON'], okna }
      await service.createTemplate(asClient(client), ADMIN, dto)

      expect(client.shiftTemplate.create).toHaveBeenCalledWith({
        data: { lokalizacjaTyp: 'ODDZIAL', nazwa: 'Dzienna', dni: ['MON'], okna },
      })
    })

    it('throws NotFound updating a missing template', async () => {
      client.shiftTemplate.findUnique.mockResolvedValue(null)
      await expect(service.updateTemplate(asClient(client), ADMIN, 'nope', { nazwa: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })
  })

  // --- Tenant isolation (G6) --------------------------------------------------------------------

  describe('tenant isolation (G6)', () => {
    it('only ever touches the tenant client handed in — never a shared/global client', async () => {
      const tenantA = makeClient()
      const tenantB = makeClient()
      tenantA.employee.findUnique.mockResolvedValue({ unitId: 'unit-Z' })
      tenantA.shift.create.mockResolvedValue({ id: 's' })

      const dto = { employeeId: 'e', lokalizacjaId: 'l', date: '2026-07-13', start: '08:00', end: '16:00', role: 'R' }
      await service.createShift(asClient(tenantA), HR, dto)

      // The write landed on tenant A's client and never on tenant B's.
      expect(tenantA.shift.create).toHaveBeenCalledTimes(1)
      expect(tenantB.shift.create).not.toHaveBeenCalled()
      expect(tenantB.employee.findUnique).not.toHaveBeenCalled()
    })
  })

  // --- Solve packing (M2-A4 correctness) --------------------------------------------------------

  describe('solveGrafik packing', () => {
    const ZERO_METRICS = { commuteTotal: 0, etatDeviation: 0, preferenceViolations: 0, fairnessScore: 0 }

    /**
     * Wire `$transaction` to a tx exposing shift.findMany (stale-AUTO lookup), shift.deleteMany/create
     * and shiftSwapRequest.deleteMany (dependent-swap clear). `staleShifts` seeds the stale-AUTO lookup.
     */
    function wireTransaction(c: MockClient, staleShifts: { id: string }[] = []) {
      const txFindMany = jest.fn().mockResolvedValue(staleShifts)
      const txDeleteMany = jest.fn().mockResolvedValue({ count: 0 })
      const txSwapDeleteMany = jest.fn().mockResolvedValue({ count: 0 })
      const txCreate = jest.fn().mockImplementation(async (arg: { data: unknown }) => arg.data)
      c.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          shift: { findMany: txFindMany, deleteMany: txDeleteMany, create: txCreate },
          shiftSwapRequest: { deleteMany: txSwapDeleteMany },
        }),
      )
      return { txFindMany, txDeleteMany, txSwapDeleteMany, txCreate }
    }

    it('empty-demand solve does not delete out-of-scope AUTO shifts (A1 data-loss guard)', async () => {
      // ADMIN (global, no unit) solves a week with ZERO demands and ZERO in-scope employees.
      client.shiftDemand.findMany.mockResolvedValue([])
      client.employee.findMany.mockResolvedValue([])
      client.lokalizacja.findMany.mockResolvedValue([])
      optimizer.solve.mockResolvedValue({ status: SolveStatus.OPTIMAL, assignments: [], unmet: [], metrics: ZERO_METRICS })
      const { txFindMany, txDeleteMany } = wireTransaction(client)

      await service.solveGrafik(asClient(client), ADMIN, { weekStart: '2026-07-13' })

      // The stale-AUTO lookup must be scoped to an EMPTY location list → matches nothing → nothing to
      // delete. With no stale shifts, neither the shift delete nor the swap-request clear runs.
      const whereArg = txFindMany.mock.calls[0]?.[0]?.where
      expect(whereArg.lokalizacjaId).toEqual({ in: [] })
      expect(txDeleteMany).not.toHaveBeenCalled()
    })

    it('packs existing MANUAL shifts as pinned demands (A2)', async () => {
      // MANAGER of unit-A. Employee E qualified KIEROWCA has a MANUAL 08:00–16:00 shift at L1 that
      // overlaps a 12:00–20:00 KIEROWCA demand at L1 the same day.
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.employee.findMany.mockResolvedValue([
        { id: 'E', qualifications: ['KIEROWCA'], etat: 1, homeLat: null, homeLng: null, preferredDaysOff: [], preferredShiftStart: [] },
      ])
      client.leaveRequest.findMany.mockResolvedValue([])
      client.shiftDemand.findMany.mockResolvedValue([
        { id: 'dem-1', lokalizacjaId: 'L1', date: new Date('2026-07-13'), start: '12:00', end: '20:00', requiredRole: 'KIEROWCA', requiredCount: 1 },
      ])
      client.shift.findMany.mockResolvedValue([
        { id: 'ms-1', employeeId: 'E', lokalizacjaId: 'L1', date: new Date('2026-07-13'), start: '08:00', end: '16:00' },
      ])
      client.lokalizacja.findMany.mockResolvedValue([{ id: 'L1', lat: null, lng: null }])
      optimizer.solve.mockResolvedValue({
        status: SolveStatus.OPTIMAL,
        assignments: [{ employeeId: 'E', demandId: 'dem-1' }],
        unmet: [],
        metrics: ZERO_METRICS,
      })
      wireTransaction(client)

      await service.solveGrafik(asClient(client), MANAGER, { weekStart: '2026-07-13' })

      const problem = optimizer.solve.mock.calls[0][0]
      const pinned = problem.demands.find((d: { role: string }) => d.role.startsWith('__pinned__'))
      expect(pinned).toBeDefined()
      expect(pinned).toMatchObject({ locId: 'L1', date: '2026-07-13', start: '08:00', end: '16:00', count: 1 })
      const e = problem.employees.find((x: { id: string }) => x.id === 'E')
      expect(e.qualifications).toContain(pinned.role)
    })

    it('skips optimizer assignments for employees outside the packed set (A3 trust boundary)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      // HR (global) packs only employee E, but the optimizer returns a shift for GHOST.
      client.employee.findMany.mockResolvedValue([
        { id: 'E', qualifications: ['KIEROWCA'], etat: 1, homeLat: null, homeLng: null, preferredDaysOff: [], preferredShiftStart: [] },
      ])
      client.leaveRequest.findMany.mockResolvedValue([])
      client.shiftDemand.findMany.mockResolvedValue([
        { id: 'dem-1', lokalizacjaId: 'L1', date: new Date('2026-07-13'), start: '12:00', end: '20:00', requiredRole: 'KIEROWCA', requiredCount: 1 },
      ])
      client.shift.findMany.mockResolvedValue([])
      client.lokalizacja.findMany.mockResolvedValue([{ id: 'L1', lat: null, lng: null }])
      optimizer.solve.mockResolvedValue({
        status: SolveStatus.OPTIMAL,
        assignments: [{ employeeId: 'GHOST', demandId: 'dem-1' }],
        unmet: [],
        metrics: ZERO_METRICS,
      })
      const { txCreate } = wireTransaction(client)

      const result = await service.solveGrafik(asClient(client), HR, { weekStart: '2026-07-13' })

      expect(txCreate).not.toHaveBeenCalled()
      expect(result.assignmentsCreated).toBe(0)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('GHOST'))
      warn.mockRestore()
    })
  })
})
