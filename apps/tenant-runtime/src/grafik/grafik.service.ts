import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import {
  Role,
  ProblemInputSchema,
  SolveStatus,
  type DemandInput,
  type EmployeeInput,
  type LocationInput,
  type Metrics,
  type TravelEntry,
  type Unmet,
} from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { CreateShiftDto, UpdateShiftDto } from './dto/shift.dto.js'
import type { CreateShiftDemandDto, UpdateShiftDemandDto } from './dto/shift-demand.dto.js'
import type { CreateShiftTemplateDto, UpdateShiftTemplateDto } from './dto/shift-template.dto.js'
import type { SolveGrafikDto } from './dto/solve.dto.js'
import { OPTIMIZER_CLIENT, type OptimizerClient } from './optimizer.client.js'
import { commuteMinutes } from './haversine.js'

/** What `POST /grafik/solve` returns to the caller (and mirrors into the audit payload). */
export interface SolveGrafikResult {
  status: SolveStatus
  /** Number of `Shift(source=AUTO)` rows persisted (0 on INFEASIBLE). */
  assignmentsCreated: number
  /** Demands the solver could not (fully) staff — surfaced so the UI can show the gaps. */
  unmet: Unmet[]
  metrics: Metrics
  /** The persisted AUTO shifts (empty on INFEASIBLE). */
  shifts: unknown[]
}

/**
 * The authenticated caller, projected from the Keycloak JWT (`sub` + `hrobot_roles`) plus the
 * request IP. Carries everything the service needs for row-level RBAC and audit — the controller
 * assembles it so the service never touches the HTTP request directly.
 */
export interface GrafikActor {
  userId: string // Keycloak subject → tenant User.keycloakSub
  roles: string[] // hrobot_roles claim
  ipAddress: string
}

/** HR and the tenant admin act across every unit; MANAGER is scoped to the unit(s) they manage. */
const GLOBAL_ROLES: string[] = [Role.HR, Role.ADMIN_KLIENTA]
const isGlobal = (roles: string[]): boolean => roles.some((r) => GLOBAL_ROLES.includes(r))

/**
 * Rdzeń Grafiku CRUD service.
 *
 * RBAC (schema-driven; see PR body):
 *  - `Shift` carries a unit via `employee.unitId`, so a MANAGER may only create/read/update/delete
 *    shifts whose employee belongs to a unit they manage; HR/ADMIN act globally.
 *  - `ShiftDemand`/`ShiftTemplate` have NO unit dimension in the tenant schema (keyed by
 *    `Lokalizacja`/facility-type), so their mutations are HR/ADMIN-only (enforced at the controller
 *    via `@TenantRoute(Role.HR, Role.ADMIN_KLIENTA)`); MANAGER may read them for planning.
 *
 * Every mutation writes an entity-typed `AuditLog` row (before/after) via AuditService, in addition
 * to the coarse HTTP-level row the AuditInterceptor writes for the request.
 *
 * NO solver call and NO `POST /grafik/solve` — the optimizer packing endpoint is M2-A4.
 */
@Injectable()
export class GrafikService {
  constructor(
    private readonly audit: AuditService,
    @Inject(OPTIMIZER_CLIENT) private readonly optimizer: OptimizerClient,
  ) {}

  // --- unit scoping ------------------------------------------------------------------------------

  /** Unit IDs the user holds a MANAGER role for (via tenant `UserRole`). */
  private async managedUnitIds(client: TenantClient, userId: string): Promise<string[]> {
    const rows = await client.userRole.findMany({
      where: { user: { keycloakSub: userId }, role: Role.MANAGER, unitId: { not: null } },
      select: { unitId: true },
    })
    return rows.map((r) => r.unitId).filter((u): u is string => u !== null)
  }

  /** Throws unless the actor is global or manages `unitId`. */
  private async assertManagesUnit(client: TenantClient, actor: GrafikActor, unitId: string): Promise<void> {
    if (isGlobal(actor.roles)) return
    const units = await this.managedUnitIds(client, actor.userId)
    if (!units.includes(unitId)) {
      throw new ForbiddenException('MANAGER may only act on their own unit')
    }
  }

  /** The unit a shift belongs to = its employee's unit. */
  private async employeeUnitId(client: TenantClient, employeeId: string): Promise<string> {
    const emp = await client.employee.findUnique({ where: { id: employeeId }, select: { unitId: true } })
    if (!emp) throw new NotFoundException(`Employee ${employeeId} not found`)
    return emp.unitId
  }

  private writeAudit(
    client: TenantClient,
    actor: GrafikActor,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.log({
      tenantClient: client,
      actorUserId: actor.userId,
      action,
      entityType,
      entityId,
      payload,
      ipAddress: actor.ipAddress,
    })
  }

  // --- Shift -------------------------------------------------------------------------------------

  async listShifts(client: TenantClient, actor: GrafikActor): Promise<unknown[]> {
    if (isGlobal(actor.roles)) {
      return client.shift.findMany({ orderBy: [{ date: 'desc' }, { start: 'asc' }] })
    }
    const units = await this.managedUnitIds(client, actor.userId)
    return client.shift.findMany({
      where: { employee: { unitId: { in: units } } },
      orderBy: [{ date: 'desc' }, { start: 'asc' }],
    })
  }

  async getShift(client: TenantClient, actor: GrafikActor, id: string): Promise<unknown> {
    const shift = await client.shift.findUnique({ where: { id } })
    if (!shift) throw new NotFoundException(`Shift ${id} not found`)
    await this.assertManagesUnit(client, actor, await this.employeeUnitId(client, shift.employeeId))
    return shift
  }

  async createShift(client: TenantClient, actor: GrafikActor, dto: CreateShiftDto): Promise<unknown> {
    await this.assertManagesUnit(client, actor, await this.employeeUnitId(client, dto.employeeId))
    const shift = await client.shift.create({
      data: {
        employeeId: dto.employeeId,
        lokalizacjaId: dto.lokalizacjaId,
        demandId: dto.demandId ?? null,
        date: new Date(dto.date),
        start: dto.start,
        end: dto.end,
        role: dto.role,
        ...(dto.source ? { source: dto.source } : {}),
      },
    })
    await this.writeAudit(client, actor, 'shift.create', 'Shift', shift.id, { after: shift })
    return shift
  }

  async updateShift(client: TenantClient, actor: GrafikActor, id: string, dto: UpdateShiftDto): Promise<unknown> {
    const before = await client.shift.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`Shift ${id} not found`)
    // Guard the shift's current unit, and — if reassigning to another employee — the target unit too.
    await this.assertManagesUnit(client, actor, await this.employeeUnitId(client, before.employeeId))
    if (dto.employeeId && dto.employeeId !== before.employeeId) {
      await this.assertManagesUnit(client, actor, await this.employeeUnitId(client, dto.employeeId))
    }
    const after = await client.shift.update({
      where: { id },
      data: {
        ...(dto.employeeId !== undefined ? { employeeId: dto.employeeId } : {}),
        ...(dto.lokalizacjaId !== undefined ? { lokalizacjaId: dto.lokalizacjaId } : {}),
        ...(dto.demandId !== undefined ? { demandId: dto.demandId } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.start !== undefined ? { start: dto.start } : {}),
        ...(dto.end !== undefined ? { end: dto.end } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
      },
    })
    await this.writeAudit(client, actor, 'shift.update', 'Shift', id, { before, after })
    return after
  }

  async deleteShift(client: TenantClient, actor: GrafikActor, id: string): Promise<{ id: string }> {
    const before = await client.shift.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`Shift ${id} not found`)
    await this.assertManagesUnit(client, actor, await this.employeeUnitId(client, before.employeeId))
    await client.shift.delete({ where: { id } })
    await this.writeAudit(client, actor, 'shift.delete', 'Shift', id, { before })
    return { id }
  }

  // --- ShiftDemand (HR/ADMIN mutations; MANAGER read) --------------------------------------------

  async listDemands(client: TenantClient): Promise<unknown[]> {
    return client.shiftDemand.findMany({ orderBy: [{ date: 'desc' }, { start: 'asc' }] })
  }

  async getDemand(client: TenantClient, id: string): Promise<unknown> {
    const demand = await client.shiftDemand.findUnique({ where: { id } })
    if (!demand) throw new NotFoundException(`ShiftDemand ${id} not found`)
    return demand
  }

  async createDemand(client: TenantClient, actor: GrafikActor, dto: CreateShiftDemandDto): Promise<unknown> {
    const demand = await client.shiftDemand.create({
      data: {
        lokalizacjaId: dto.lokalizacjaId,
        date: new Date(dto.date),
        start: dto.start,
        end: dto.end,
        requiredRole: dto.requiredRole,
        requiredCount: dto.requiredCount,
        ...(dto.source ? { source: dto.source } : {}),
      },
    })
    await this.writeAudit(client, actor, 'shiftDemand.create', 'ShiftDemand', demand.id, { after: demand })
    return demand
  }

  async updateDemand(client: TenantClient, actor: GrafikActor, id: string, dto: UpdateShiftDemandDto): Promise<unknown> {
    const before = await client.shiftDemand.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`ShiftDemand ${id} not found`)
    const after = await client.shiftDemand.update({
      where: { id },
      data: {
        ...(dto.lokalizacjaId !== undefined ? { lokalizacjaId: dto.lokalizacjaId } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.start !== undefined ? { start: dto.start } : {}),
        ...(dto.end !== undefined ? { end: dto.end } : {}),
        ...(dto.requiredRole !== undefined ? { requiredRole: dto.requiredRole } : {}),
        ...(dto.requiredCount !== undefined ? { requiredCount: dto.requiredCount } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
      },
    })
    await this.writeAudit(client, actor, 'shiftDemand.update', 'ShiftDemand', id, { before, after })
    return after
  }

  async deleteDemand(client: TenantClient, actor: GrafikActor, id: string): Promise<{ id: string }> {
    const before = await client.shiftDemand.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`ShiftDemand ${id} not found`)
    await client.shiftDemand.delete({ where: { id } })
    await this.writeAudit(client, actor, 'shiftDemand.delete', 'ShiftDemand', id, { before })
    return { id }
  }

  // --- ShiftTemplate (HR/ADMIN mutations; MANAGER read) ------------------------------------------

  async listTemplates(client: TenantClient): Promise<unknown[]> {
    return client.shiftTemplate.findMany({ orderBy: { nazwa: 'asc' } })
  }

  async getTemplate(client: TenantClient, id: string): Promise<unknown> {
    const template = await client.shiftTemplate.findUnique({ where: { id } })
    if (!template) throw new NotFoundException(`ShiftTemplate ${id} not found`)
    return template
  }

  async createTemplate(client: TenantClient, actor: GrafikActor, dto: CreateShiftTemplateDto): Promise<unknown> {
    const template = await client.shiftTemplate.create({
      data: {
        lokalizacjaTyp: dto.lokalizacjaTyp,
        nazwa: dto.nazwa,
        ...(dto.dni ? { dni: dto.dni } : {}),
        okna: dto.okna as TenantPrisma.InputJsonValue,
      },
    })
    await this.writeAudit(client, actor, 'shiftTemplate.create', 'ShiftTemplate', template.id, { after: template })
    return template
  }

  async updateTemplate(
    client: TenantClient,
    actor: GrafikActor,
    id: string,
    dto: UpdateShiftTemplateDto,
  ): Promise<unknown> {
    const before = await client.shiftTemplate.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`ShiftTemplate ${id} not found`)
    const after = await client.shiftTemplate.update({
      where: { id },
      data: {
        ...(dto.lokalizacjaTyp !== undefined ? { lokalizacjaTyp: dto.lokalizacjaTyp } : {}),
        ...(dto.nazwa !== undefined ? { nazwa: dto.nazwa } : {}),
        ...(dto.dni !== undefined ? { dni: dto.dni } : {}),
        ...(dto.okna !== undefined ? { okna: dto.okna as TenantPrisma.InputJsonValue } : {}),
      },
    })
    await this.writeAudit(client, actor, 'shiftTemplate.update', 'ShiftTemplate', id, { before, after })
    return after
  }

  async deleteTemplate(client: TenantClient, actor: GrafikActor, id: string): Promise<{ id: string }> {
    const before = await client.shiftTemplate.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`ShiftTemplate ${id} not found`)
    await client.shiftTemplate.delete({ where: { id } })
    await this.writeAudit(client, actor, 'shiftTemplate.delete', 'ShiftTemplate', id, { before })
    return { id }
  }

  // --- Solve (M2-A4: pack → optimize → persist) --------------------------------------------------

  /** `YYYY-MM-DD` from a `@db.Date` value (stored at UTC midnight). */
  private isoDate(d: Date): string {
    return d.toISOString().slice(0, 10)
  }

  /**
   * Resolve which units' employees the caller may feed to the solver.
   *  - Global (HR/ADMIN): the requested `unitId`, or `null` = every unit.
   *  - MANAGER: only units they manage. A requested `unitId` must be one of them (else Forbidden);
   *    omitting it means "all units I manage" (Forbidden if they manage none).
   * Returns the unit-id allowlist, or `null` for "no unit restriction".
   */
  private async resolveUnitScope(client: TenantClient, actor: GrafikActor, unitId?: string): Promise<string[] | null> {
    if (isGlobal(actor.roles)) return unitId ? [unitId] : null
    const managed = await this.managedUnitIds(client, actor.userId)
    if (unitId) {
      if (!managed.includes(unitId)) throw new ForbiddenException('MANAGER may only solve their own unit')
      return [unitId]
    }
    if (managed.length === 0) throw new ForbiddenException('MANAGER manages no unit')
    return managed
  }

  /**
   * The A4 vertical slice: pack a scheduling problem for `weekStart` × scope from the DB, hand it to
   * the optimizer, and persist the returned assignments as `Shift(source=AUTO)`.
   *
   * Re-solve semantics: on a feasible solve we first delete prior AUTO shifts for the same week
   * within the solved scope (unit + touched locations), then insert the new ones — a re-solve
   * REPLACES the machine's previous answer. Human-placed MANUAL shifts are never touched.
   *
   * DATA-GAP: the tenant schema has no LeaveRequest / AttendanceRecord model, so every employee is
   * packed with `approvedLeaveDates: []` and `historyHours: 0` (see PR body). Adding those models is
   * out of A4 scope.
   */
  async solveGrafik(client: TenantClient, actor: GrafikActor, dto: SolveGrafikDto): Promise<SolveGrafikResult> {
    const unitScope = await this.resolveUnitScope(client, actor, dto.unitId)

    const weekStartDate = new Date(`${dto.weekStart}T00:00:00.000Z`)
    const weekEndExcl = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000)

    // demands: week × optional location filter.
    const demandRows = await client.shiftDemand.findMany({
      where: {
        date: { gte: weekStartDate, lt: weekEndExcl },
        ...(dto.lokalizacjaIds ? { lokalizacjaId: { in: dto.lokalizacjaIds } } : {}),
      },
    })
    // employees: the in-scope units.
    const employeeRows = await client.employee.findMany({
      where: unitScope ? { unitId: { in: unitScope } } : {},
    })
    // locations: those actually referenced by the week's demands.
    const locIds = [...new Set(demandRows.map((d) => d.lokalizacjaId))]
    const locationRows = locIds.length
      ? await client.lokalizacja.findMany({ where: { id: { in: locIds } } })
      : []

    const demands: DemandInput[] = demandRows.map((d) => ({
      id: d.id,
      locId: d.lokalizacjaId,
      date: this.isoDate(d.date),
      start: d.start,
      end: d.end,
      role: d.requiredRole,
      count: d.requiredCount,
    }))
    const employees: EmployeeInput[] = employeeRows.map((e) => ({
      id: e.id,
      qualifications: e.qualifications,
      etat: Number(e.etat),
      homeLatLng: e.homeLat != null && e.homeLng != null ? { lat: e.homeLat, lng: e.homeLng } : null,
      approvedLeaveDates: [], // DATA-GAP: no LeaveRequest model (see PR body)
      historyHours: 0, // DATA-GAP: no AttendanceRecord model (see PR body)
    }))
    const locations: LocationInput[] = locationRows.map((l) => ({
      id: l.id,
      latLng: l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null,
    }))
    // travelMatrix: haversine minutes, skipping any endpoint without coordinates.
    const travelMatrix: TravelEntry[] = []
    for (const e of employeeRows) {
      if (e.homeLat == null || e.homeLng == null) continue
      const home = { lat: e.homeLat, lng: e.homeLng }
      for (const l of locationRows) {
        if (l.lat == null || l.lng == null) continue
        travelMatrix.push({ employeeId: e.id, locId: l.id, minutes: commuteMinutes(home, { lat: l.lat, lng: l.lng }) })
      }
    }

    // Validate against the frozen contract before it leaves the process.
    const problem = ProblemInputSchema.parse({
      horizon: { weekStart: dto.weekStart },
      locations,
      employees,
      demands,
      travelMatrix,
      weights: { d: 1, e: 1, g: 1 },
      solverConfig: { seed: 42, timeLimit: 10 },
    })

    const result = await this.optimizer.solve(problem)

    const scope = {
      weekStart: dto.weekStart,
      unitIds: unitScope,
      lokalizacjaIds: dto.lokalizacjaIds ?? null,
    }

    if (result.status === SolveStatus.INFEASIBLE) {
      // Persist nothing; surface the gaps + audit the attempt.
      await this.writeAudit(client, actor, 'grafik.solve', 'Grafik', dto.weekStart, {
        scope,
        status: result.status,
        assignmentsCreated: 0,
        unmet: result.unmet,
      })
      return { status: result.status, assignmentsCreated: 0, unmet: result.unmet, metrics: result.metrics, shifts: [] }
    }

    // OPTIMAL / FEASIBLE → replace prior AUTO shifts for the scope, then insert the new assignments.
    const demandById = new Map(demandRows.map((d) => [d.id, d]))
    const shifts = await client.$transaction(async (tx) => {
      await tx.shift.deleteMany({
        where: {
          source: 'AUTO',
          date: { gte: weekStartDate, lt: weekEndExcl },
          ...(locIds.length ? { lokalizacjaId: { in: locIds } } : {}),
          ...(unitScope ? { employee: { unitId: { in: unitScope } } } : {}),
        },
      })
      const created: unknown[] = []
      for (const a of result.assignments) {
        const d = demandById.get(a.demandId)
        if (!d) continue // solver referenced a demand outside the packed scope — skip defensively
        created.push(
          await tx.shift.create({
            data: {
              employeeId: a.employeeId,
              lokalizacjaId: d.lokalizacjaId,
              demandId: d.id,
              date: d.date,
              start: d.start,
              end: d.end,
              role: d.requiredRole,
              source: 'AUTO',
            },
          }),
        )
      }
      return created
    })

    await this.writeAudit(client, actor, 'grafik.solve', 'Grafik', dto.weekStart, {
      scope,
      status: result.status,
      assignmentsCreated: shifts.length,
      unmet: result.unmet,
    })

    return { status: result.status, assignmentsCreated: shifts.length, unmet: result.unmet, metrics: result.metrics, shifts }
  }
}
