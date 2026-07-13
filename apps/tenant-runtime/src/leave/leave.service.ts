import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import { LeaveAction, LeaveStatus, nextLeaveState } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { ReplacementService } from '../ai-grafik/replacement.service.js'
import { AiProposalService } from '../ai-grafik/ai-proposal.service.js'
import type { CreateLeaveDto } from './dto/leave.dto.js'

/** The acting user projected from the JWT + IP (mirrors EmployeeActor/AiConfigActor). */
export interface LeaveActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/** Filters for {@link LeaveService.list}. */
export interface LeaveListFilter {
  /** Restrict to the caller's OWN requests (via their Employee record). */
  mine?: boolean
  /** Narrow to a single {@link LeaveStatus}. */
  state?: string
  /** Narrow to leaves whose employee sits in this unit (intersected with the actor's scope). */
  unitId?: string
}

/**
 * RODO ALLOWLIST projection: only the LeaveRequest's own columns + `employeeId`. The `employee`
 * relation is NEVER selected, so no employee PII (name/PESEL/home address) can leak into a leave
 * response or the append-only audit log — the frontend enriches names from the roster separately.
 */
const LEAVE_SELECT = {
  id: true,
  employeeId: true,
  startDate: true,
  endDate: true,
  status: true,
  type: true,
  decidedByUserId: true,
  decidedAt: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
} as const

/** A leave row projected through {@link LEAVE_SELECT} (the shape every read/write path returns). */
type LeaveRow = TenantPrisma.LeaveRequestGetPayload<{ select: typeof LEAVE_SELECT }>

/**
 * Wnioski (leave-request) approval workflow (M2 core-modules). Mirrors the RBAC + audit conventions
 * of `EmployeesService`/`AiProposalService`: HR/ADMIN_KLIENTA act across every unit (`isGlobal`), a
 * MANAGER only on the unit(s) they manage (`managedUnitIds`), a plain PRACOWNIK only on their own
 * requests. A MAKER-CHECKER rule forbids anyone — HR/ADMIN included — from deciding their OWN
 * request. Approving a request fires the AI-grafik replacement auto-scan tie-in (best-effort).
 * Audit payloads carry IDs only — never PII.
 */
@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name)

  constructor(
    private readonly audit: AuditService,
    private readonly replacement: ReplacementService,
    private readonly proposals: AiProposalService,
  ) {}

  private writeAudit(client: TenantClient, actor: LeaveActor, action: string, id: string, payload: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action, entityType: 'LeaveRequest', entityId: id, payload, ipAddress: actor.ipAddress })
  }

  /** The caller's own Employee id (via `User.keycloakSub`), or null when the login has no Employee. */
  private async ownEmployeeId(client: TenantClient, actor: LeaveActor): Promise<string | null> {
    const me = await client.employee.findFirst({ where: { user: { keycloakSub: actor.userId } }, select: { id: true } })
    return me?.id ?? null
  }

  /** The caller's own `User.id` (JWT `sub` == `keycloakSub` != `User.id`), or null if none. */
  private async ownUserId(client: TenantClient, actor: LeaveActor): Promise<string | null> {
    const user = await client.user.findFirst({ where: { keycloakSub: actor.userId }, select: { id: true } })
    return user?.id ?? null
  }

  /** The unit a leave's employee belongs to (for MANAGER scope checks), or null if unresolved. */
  private async leaveEmployeeUnitId(client: TenantClient, employeeId: string): Promise<string | null> {
    const emp = await client.employee.findUnique({ where: { id: employeeId }, select: { unitId: true } })
    return emp?.unitId ?? null
  }

  /**
   * File a new leave request. A GLOBAL actor (HR/ADMIN) may file on behalf of any employee via
   * `dto.employeeId`; everyone else files against their OWN Employee record (dto.employeeId ignored).
   * The request is created EXPLICITLY in PENDING — a decider must approve/reject it. Audit `leave.created`.
   */
  async createRequest(client: TenantClient, actor: LeaveActor, dto: CreateLeaveDto): Promise<LeaveRow> {
    // FIX 4: reject an inverted range up front — equal dates (a single-day leave) are allowed.
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('endDate cannot be before startDate')
    }

    let employeeId: string
    if (dto.employeeId != null && isGlobal(actor.roles)) {
      employeeId = dto.employeeId
    } else {
      const own = await this.ownEmployeeId(client, actor)
      if (own == null) throw new NotFoundException('No employee record for the current user')
      employeeId = own
    }

    const created = await client.leaveRequest.create({
      data: {
        employeeId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        type: dto.type,
        status: LeaveStatus.PENDING,
      },
      select: LEAVE_SELECT,
    })

    await this.writeAudit(client, actor, 'leave.created', created.id, {
      employeeId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      type: dto.type,
      status: LeaveStatus.PENDING,
    })
    return created
  }

  /**
   * Role-scoped list. A GLOBAL actor sees every request; a MANAGER only those whose employee sits in
   * a unit they manage; a plain PRACOWNIK only their own. `mine` forces the own-only view for any
   * role; `state`/`unitId` narrow within the actor's scope. PII-free (see {@link LEAVE_SELECT}).
   */
  async list(client: TenantClient, actor: LeaveActor, filter: LeaveListFilter = {}): Promise<LeaveRow[]> {
    const { mine, state, unitId } = filter
    const where: TenantPrisma.LeaveRequestWhereInput = {}
    if (state != null) where.status = state as LeaveStatus

    const find = (): Promise<LeaveRow[]> =>
      client.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' }, select: LEAVE_SELECT })

    if (mine) {
      const meId = await this.ownEmployeeId(client, actor)
      if (meId == null) return []
      where.employeeId = meId
      return find()
    }

    if (isGlobal(actor.roles)) {
      if (unitId != null) where.employee = { unitId }
      return find()
    }

    const managed = await managedUnitIds(client, actor.userId)
    if (managed.length > 0) {
      const units = unitId != null ? managed.filter((u) => u === unitId) : managed
      where.employee = { unitId: { in: units } }
      return find()
    }

    // Plain PRACOWNIK: own requests only.
    const meId = await this.ownEmployeeId(client, actor)
    if (meId == null) return []
    where.employeeId = meId
    return find()
  }

  /**
   * Load one request with the SAME scope as {@link list}: 404 first for an unknown id, then a 403 for
   * one that exists but is outside the actor's scope. Returns the PII-free {@link LEAVE_SELECT} row.
   */
  async getById(client: TenantClient, actor: LeaveActor, id: string): Promise<LeaveRow> {
    const leave = await client.leaveRequest.findUnique({ where: { id }, select: LEAVE_SELECT })
    if (!leave) throw new NotFoundException(`Leave request ${id} not found`)
    if (isGlobal(actor.roles)) return leave

    const managed = await managedUnitIds(client, actor.userId)
    if (managed.length > 0) {
      const unitId = await this.leaveEmployeeUnitId(client, leave.employeeId)
      if (unitId != null && managed.includes(unitId)) return leave
      throw new ForbiddenException('Leave request is outside your scope')
    }

    const meId = await this.ownEmployeeId(client, actor)
    if (meId != null && meId === leave.employeeId) return leave
    throw new ForbiddenException('Leave request is outside your scope')
  }

  /**
   * A manager/HR decides a PENDING request. Authorize: GLOBAL (HR/ADMIN) or MANAGER of the leave's
   * employee's unit, else 403. [MAKER-CHECKER] no one — HR/ADMIN included — may decide their OWN
   * request (actor's Employee == the leave's employee → 403). The flip is optimistic-locked on
   * `status: PENDING` (concurrent change → 409). Audit `leave.approved`/`leave.rejected`.
   *
   * [AUTO-SCAN TIE-IN] After a successful APPROVE, the approved employee's shifts colliding with the
   * leave interval are scanned and an AI replacement proposal is created per colliding shift (reusing
   * {@link ReplacementService.findVacatedShifts} + {@link AiProposalService.createReplacement},
   * honouring the unit's autonomy config). Wrapped in try/catch so a tie-in failure never fails the
   * approve itself.
   */
  async decide(client: TenantClient, actor: LeaveActor, id: string, { approve, reason }: { approve: boolean; reason?: string }): Promise<LeaveRow> {
    const leave = await client.leaveRequest.findUnique({ where: { id }, select: LEAVE_SELECT })
    if (!leave) throw new NotFoundException(`Leave request ${id} not found`)

    // Authorize: GLOBAL, or a MANAGER of the leave employee's unit. A plain PRACOWNIK (managed = [])
    // falls through to the 403.
    if (!isGlobal(actor.roles)) {
      const managed = await managedUnitIds(client, actor.userId)
      const unitId = await this.leaveEmployeeUnitId(client, leave.employeeId)
      if (unitId == null || !managed.includes(unitId)) {
        throw new ForbiddenException('Leave request is outside your scope')
      }
    }

    if (leave.status !== LeaveStatus.PENDING) throw new ConflictException('Leave request is not pending')

    // MAKER-CHECKER: no self-approval, even for HR/ADMIN.
    const meId = await this.ownEmployeeId(client, actor)
    if (meId != null && meId === leave.employeeId) {
      throw new ForbiddenException('You cannot decide your own leave request')
    }

    const target = nextLeaveState(LeaveStatus.PENDING, approve ? LeaveAction.Approve : LeaveAction.Reject)
    const decidedByUserId = await this.ownUserId(client, actor)

    const flipped = await client.leaveRequest.updateMany({
      where: { id, status: LeaveStatus.PENDING },
      data: { status: target, decidedByUserId, decidedAt: new Date(), reason: reason ?? null },
    })
    if (flipped.count === 0) throw new ConflictException('Leave request changed concurrently')

    await this.writeAudit(client, actor, approve ? 'leave.approved' : 'leave.rejected', id, {
      employeeId: leave.employeeId,
      status: target,
      decidedByUserId,
    })

    if (approve) await this.autoScanReplacements(client, actor, leave)

    return client.leaveRequest.findUniqueOrThrow({ where: { id }, select: LEAVE_SELECT })
  }

  /**
   * AUTO-SCAN TIE-IN: after an approve, find the approved employee's shifts that now collide with the
   * leave interval and create an AI replacement proposal for each. Best-effort — any failure is
   * logged and swallowed so it can NEVER fail the approve that already committed.
   */
  private async autoScanReplacements(client: TenantClient, actor: LeaveActor, leave: LeaveRow): Promise<void> {
    try {
      const range = { from: leave.startDate.toISOString().slice(0, 10), to: leave.endDate.toISOString().slice(0, 10) }
      const vacated = await this.replacement.findVacatedShifts(client, actor, range)
      const colliding = vacated.filter((s) => s.employeeId === leave.employeeId)
      for (const shift of colliding) {
        await this.proposals.createReplacement(client, actor, shift.id, `leave ${leave.id} approved`)
      }
    } catch (err) {
      this.logger.warn(`auto-scan replacement tie-in failed for leave ${leave.id}: ${(err as Error).message}`)
    }
  }

  /**
   * Cancel a request. ONLY the requester (their own Employee) may cancel, and only while PENDING. The
   * flip is optimistic-locked on `status: PENDING` (concurrent change → 409). Audit `leave.cancelled`.
   */
  async cancel(client: TenantClient, actor: LeaveActor, id: string): Promise<LeaveRow> {
    const leave = await client.leaveRequest.findUnique({ where: { id }, select: LEAVE_SELECT })
    if (!leave) throw new NotFoundException(`Leave request ${id} not found`)

    const meId = await this.ownEmployeeId(client, actor)
    if (meId == null || meId !== leave.employeeId) {
      throw new ForbiddenException('You can only cancel your own leave request')
    }
    if (leave.status !== LeaveStatus.PENDING) throw new ConflictException('Leave request is not pending')

    const target = nextLeaveState(LeaveStatus.PENDING, LeaveAction.Cancel)
    const flipped = await client.leaveRequest.updateMany({
      where: { id, status: LeaveStatus.PENDING },
      data: { status: target },
    })
    if (flipped.count === 0) throw new ConflictException('Leave request changed concurrently')

    await this.writeAudit(client, actor, 'leave.cancelled', id, { employeeId: leave.employeeId, status: target })
    return client.leaveRequest.findUniqueOrThrow({ where: { id }, select: LEAVE_SELECT })
  }
}
