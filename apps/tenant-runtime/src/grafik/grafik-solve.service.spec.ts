import { Test, TestingModule } from '@nestjs/testing'
import { ForbiddenException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role, SolveStatus, type SolveResult } from '@hrobot/shared'
import { GrafikService, type GrafikActor } from './grafik.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { OPTIMIZER_CLIENT, type OptimizerClient } from './optimizer.client.js'

/**
 * A4 vertical-slice tests: pack a small synthetic scenario, mock the optimizer, and assert the
 * correct `Shift(source=AUTO)` rows are persisted (+ audit) on a feasible solve, that INFEASIBLE
 * persists nothing but surfaces `unmet`, and that RBAC scopes a MANAGER to their own unit.
 *
 * Synthetic data only (RODO).
 */

const D1 = '2026-07-13' // Monday of the solved week
const weekDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)

/** Two demands at one geocoded location, within the week. */
const demandRows = [
  { id: 'dem-1', lokalizacjaId: 'loc-1', date: weekDate('2026-07-13'), start: '08:00', end: '16:00', requiredRole: 'NURSE', requiredCount: 1 },
  { id: 'dem-2', lokalizacjaId: 'loc-1', date: weekDate('2026-07-14'), start: '08:00', end: '16:00', requiredRole: 'NURSE', requiredCount: 1 },
]
/** Two employees in unit-A; emp-1 geocoded, emp-2 not (exercises the travelMatrix skip). */
const employeeRows = [
  { id: 'emp-1', unitId: 'unit-A', qualifications: ['NURSE'], etat: 1, homeLat: 52.0, homeLng: 21.0 },
  { id: 'emp-2', unitId: 'unit-A', qualifications: ['NURSE'], etat: 0.5, homeLat: null, homeLng: null },
]
const locationRows = [{ id: 'loc-1', lat: 52.2, lng: 21.0 }]

function makeClient() {
  return {
    shift: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `shift-${String(data.demandId)}`, ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    shiftDemand: { findMany: jest.fn().mockResolvedValue(demandRows) },
    employee: { findMany: jest.fn().mockResolvedValue(employeeRows) },
    lokalizacja: { findMany: jest.fn().mockResolvedValue(locationRows) },
    userRole: { findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(makeTxProxy())),
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

// The tx callback receives a client with the same shift delegate; we route it back to the outer mock.
let currentClient: MockClient
const makeTxProxy = (): unknown => ({ shift: currentClient.shift })

const MANAGER: GrafikActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.1' }
const HR: GrafikActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.2' }

const feasible: SolveResult = {
  status: SolveStatus.OPTIMAL,
  assignments: [
    { employeeId: 'emp-1', demandId: 'dem-1' },
    { employeeId: 'emp-2', demandId: 'dem-2' },
  ],
  metrics: { commuteTotal: 30, etatDeviation: 0, fairnessScore: 0 },
  unmet: [],
}
const infeasible: SolveResult = {
  status: SolveStatus.INFEASIBLE,
  assignments: [],
  metrics: { commuteTotal: 0, etatDeviation: 0, fairnessScore: 0 },
  unmet: [{ demandId: 'dem-1', reason: 'no qualified employee available' }],
}

describe('GrafikService.solveGrafik (A4 vertical slice)', () => {
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
    currentClient = client
    jest.clearAllMocks()
    client.shift.deleteMany.mockResolvedValue({ count: 0 })
  })

  // --- packing --------------------------------------------------------------------------------

  it('packs demands, employees, locations and a haversine travelMatrix into a valid ProblemInput', async () => {
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    expect(optimizer.solve).toHaveBeenCalledTimes(1)
    const problem = optimizer.solve.mock.calls[0][0]
    expect(problem.horizon).toEqual({ weekStart: D1 })
    expect(problem.demands).toHaveLength(2)
    expect(problem.demands[0]).toEqual({ id: 'dem-1', locId: 'loc-1', date: '2026-07-13', start: '08:00', end: '16:00', role: 'NURSE', count: 1 })
    // DATA-GAP: no LeaveRequest / AttendanceRecord model → packed as empty / zero.
    expect(problem.employees).toEqual([
      { id: 'emp-1', qualifications: ['NURSE'], etat: 1, homeLatLng: { lat: 52.0, lng: 21.0 }, approvedLeaveDates: [], historyHours: 0 },
      { id: 'emp-2', qualifications: ['NURSE'], etat: 0.5, homeLatLng: null, approvedLeaveDates: [], historyHours: 0 },
    ])
    expect(problem.locations).toEqual([{ id: 'loc-1', latLng: { lat: 52.2, lng: 21.0 } }])
    // Only emp-1 (geocoded) → one travel entry; emp-2 skipped.
    expect(problem.travelMatrix).toHaveLength(1)
    expect(problem.travelMatrix[0]).toMatchObject({ employeeId: 'emp-1', locId: 'loc-1' })
    expect(problem.travelMatrix[0].minutes).toBeGreaterThan(0)
    expect(problem.solverConfig.seed).toBe(42)
  })

  // --- persist (feasible) ---------------------------------------------------------------------

  it('persists one Shift(source=AUTO) per assignment and audits, replacing prior AUTO shifts', async () => {
    optimizer.solve.mockResolvedValue(feasible)

    const res = await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    // Re-solve semantics: prior AUTO shifts for the week are cleared first.
    expect(client.shift.deleteMany).toHaveBeenCalledTimes(1)
    const delWhere = client.shift.deleteMany.mock.calls[0]![0].where
    expect(delWhere.source).toBe('AUTO')
    expect(delWhere.lokalizacjaId).toEqual({ in: ['loc-1'] })

    expect(client.shift.create).toHaveBeenCalledTimes(2)
    const firstShift = client.shift.create.mock.calls[0]![0].data
    expect(firstShift).toMatchObject({ employeeId: 'emp-1', lokalizacjaId: 'loc-1', demandId: 'dem-1', role: 'NURSE', source: 'AUTO', start: '08:00', end: '16:00' })
    expect(firstShift.date).toEqual(weekDate('2026-07-13'))

    expect(res.status).toBe(SolveStatus.OPTIMAL)
    expect(res.assignmentsCreated).toBe(2)
    expect(res.shifts).toHaveLength(2)

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'kc-hr',
        action: 'grafik.solve',
        entityType: 'Grafik',
        entityId: D1,
        payload: expect.objectContaining({ status: SolveStatus.OPTIMAL, assignmentsCreated: 2 }),
      }),
    )
  })

  it('skips assignments whose demand is outside the packed scope', async () => {
    optimizer.solve.mockResolvedValue({
      ...feasible,
      assignments: [{ employeeId: 'emp-1', demandId: 'dem-1' }, { employeeId: 'emp-9', demandId: 'ghost' }],
    })

    const res = await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    expect(client.shift.create).toHaveBeenCalledTimes(1)
    expect(res.assignmentsCreated).toBe(1)
  })

  // --- INFEASIBLE -----------------------------------------------------------------------------

  it('persists nothing and surfaces unmet on INFEASIBLE, still auditing the attempt', async () => {
    optimizer.solve.mockResolvedValue(infeasible)

    const res = await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    expect(client.$transaction).not.toHaveBeenCalled()
    expect(client.shift.create).not.toHaveBeenCalled()
    expect(client.shift.deleteMany).not.toHaveBeenCalled()
    expect(res.status).toBe(SolveStatus.INFEASIBLE)
    expect(res.assignmentsCreated).toBe(0)
    expect(res.unmet).toEqual(infeasible.unmet)

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'grafik.solve', payload: expect.objectContaining({ status: SolveStatus.INFEASIBLE, assignmentsCreated: 0 }) }),
    )
  })

  // --- RBAC -----------------------------------------------------------------------------------

  it('forbids a MANAGER solving another unit and never queries/optimizes', async () => {
    client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

    await expect(service.solveGrafik(asClient(client), MANAGER, { weekStart: D1, unitId: 'unit-B' })).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(optimizer.solve).not.toHaveBeenCalled()
    expect(client.shiftDemand.findMany).not.toHaveBeenCalled()
  })

  it('lets a MANAGER solve their own unit, scoping the employee query to it', async () => {
    client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), MANAGER, { weekStart: D1, unitId: 'unit-A' })

    expect(client.employee.findMany).toHaveBeenCalledWith({ where: { unitId: { in: ['unit-A'] } } })
    expect(optimizer.solve).toHaveBeenCalledTimes(1)
  })

  it('lets HR/ADMIN solve any unit (no scoping query needed)', async () => {
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), HR, { weekStart: D1, unitId: 'unit-Z' })

    expect(client.userRole.findMany).not.toHaveBeenCalled()
    expect(client.employee.findMany).toHaveBeenCalledWith({ where: { unitId: { in: ['unit-Z'] } } })
  })
})
