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
      findMany: jest.fn().mockResolvedValue([]), // MANUAL-shift occupancy pack (A2); default: none
    },
    shiftDemand: { findMany: jest.fn().mockResolvedValue(demandRows) },
    employee: { findMany: jest.fn().mockResolvedValue(employeeRows) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
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
    // No approved leave rows for this week → approvedLeaveDates empty; historyHours still a DATA-GAP (0).
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

  it('omits `preferences` for employees without any set preference (payload stays clean)', async () => {
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    const problem = optimizer.solve.mock.calls[0][0]
    // Neither employee in the default fixture has preferences → `preferences` is undefined, so it
    // drops out of the JSON payload the optimizer actually receives (clean wire shape).
    expect(problem.employees[0].preferences).toBeUndefined()
    expect(problem.employees[1].preferences).toBeUndefined()
    expect(JSON.stringify(problem.employees[0])).not.toContain('preferences')
  })

  it('packs soft `preferences` (only non-empty sub-lists) + a preference weight `p` when set', async () => {
    client.employee.findMany.mockResolvedValue([
      // emp-1: both sub-lists set → both packed.
      { id: 'emp-1', unitId: 'unit-A', qualifications: ['NURSE'], etat: 1, homeLat: 52.0, homeLng: 21.0, preferredDaysOff: ['SAT', 'SUN'], preferredShiftStart: ['08:00'] },
      // emp-2: only days-off set (empty start list) → start sub-list omitted.
      { id: 'emp-2', unitId: 'unit-A', qualifications: ['NURSE'], etat: 0.5, homeLat: null, homeLng: null, preferredDaysOff: ['MON'], preferredShiftStart: [] },
    ])
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    const problem = optimizer.solve.mock.calls[0][0]
    expect(problem.employees[0].preferences).toEqual({ preferredDaysOff: ['SAT', 'SUN'], preferredShiftStart: ['08:00'] })
    expect(problem.employees[1].preferences).toEqual({ preferredDaysOff: ['MON'] })
    expect(problem.employees[1].preferences).not.toHaveProperty('preferredShiftStart')
    // Preference-objective weight travels alongside {d,e,g}.
    expect(problem.weights).toMatchObject({ d: 1, e: 1, g: 1 })
    expect(problem.weights.p).toBeGreaterThan(0)
  })

  // --- leave packing (H3 data-gap closed) -----------------------------------------------------

  it('queries only APPROVED leave overlapping the solve week, for the in-scope employees, in one query', async () => {
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    expect(client.leaveRequest.findMany).toHaveBeenCalledTimes(1)
    expect(client.leaveRequest.findMany).toHaveBeenCalledWith({
      where: {
        employeeId: { in: ['emp-1', 'emp-2'] },
        status: 'APPROVED',
        // Overlap of [startDate, endDate] with [weekStart, weekEnd): starts before the week ends and ends on/after it starts.
        startDate: { lt: weekDate('2026-07-20') }, // weekStart + 7d (exclusive)
        endDate: { gte: weekDate('2026-07-13') }, // weekStart
      },
    })
  })

  it('expands an approved leave interval to the in-week ISO dates and packs them per employee', async () => {
    // emp-1 on leave Tue–Wed of the solved week; emp-2 has none.
    client.leaveRequest.findMany.mockResolvedValue([
      { employeeId: 'emp-1', startDate: weekDate('2026-07-14'), endDate: weekDate('2026-07-15'), status: 'APPROVED', type: 'URLOP_WYPOCZYNKOWY' },
    ])
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    const problem = optimizer.solve.mock.calls[0][0]
    const emp1 = problem.employees.find((e: { id: string }) => e.id === 'emp-1')
    const emp2 = problem.employees.find((e: { id: string }) => e.id === 'emp-2')
    expect(emp1.approvedLeaveDates).toEqual(['2026-07-14', '2026-07-15'])
    expect(emp2.approvedLeaveDates).toEqual([])
  })

  it('clamps a leave interval spanning the week boundaries to only the dates inside the solve week', async () => {
    // Leave runs Fri (prev week) → Mon of the solved week; only the Monday (2026-07-13) is in-week.
    client.leaveRequest.findMany.mockResolvedValue([
      { employeeId: 'emp-1', startDate: weekDate('2026-07-10'), endDate: weekDate('2026-07-13'), status: 'APPROVED', type: 'URLOP_WYPOCZYNKOWY' },
    ])
    optimizer.solve.mockResolvedValue(feasible)

    await service.solveGrafik(asClient(client), HR, { weekStart: D1 })

    const problem = optimizer.solve.mock.calls[0][0]
    const emp1 = problem.employees.find((e: { id: string }) => e.id === 'emp-1')
    expect(emp1.approvedLeaveDates).toEqual(['2026-07-13'])
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
