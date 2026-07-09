import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { CreateShiftDto, UpdateShiftDto } from './dto/shift.dto.js'
import type { CreateShiftDemandDto, UpdateShiftDemandDto } from './dto/shift-demand.dto.js'
import type { CreateShiftTemplateDto, UpdateShiftTemplateDto } from './dto/shift-template.dto.js'

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
  constructor(private readonly audit: AuditService) {}

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
}
