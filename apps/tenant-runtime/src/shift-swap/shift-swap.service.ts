import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import {
  SwapAction,
  SwapState,
  SwapRequestNotFoundError,
  SwapNotFeasibleError,
  InvalidSwapTargetError,
  nextState,
} from './swap-state-machine.js'
import type { CreateSwapRequestDto } from './dto/shift-swap.dto.js'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  type SwapFeasibilityValidator,
} from './swap-feasibility-validator.js'

/** A persisted ShiftSwapRequest row (all scalar fields), derived from the client return type. */
type SwapRequestRow = NonNullable<
  Awaited<ReturnType<TenantClient['shiftSwapRequest']['findUnique']>>
>

/**
 * The authenticated caller, projected from the Keycloak JWT (`sub` + `hrobot_roles`), mirroring
 * `GrafikActor`. Carries what row-level RBAC needs; the controller assembles it so the service never
 * touches the HTTP request.
 */
export interface SwapActor {
  userId: string // Keycloak subject → tenant User.keycloakSub
  roles: string[] // hrobot_roles claim
}

/** HR and the tenant admin act across every unit; MANAGER is scoped to the unit(s) they manage. */
const GLOBAL_ROLES: string[] = [Role.HR, Role.ADMIN_KLIENTA]
const isGlobal = (roles: string[]): boolean => roles.some((r) => GLOBAL_ROLES.includes(r))

/** Context threaded through the manager decision — the deciding manager + audit provenance. */
export interface ManagerDecisionInput {
  approve: boolean
  /** Manager taking the decision; persisted to `decidedByManagerId`. */
  decidedByManagerId: string
  /** User id recorded as the audit actor (the manager's User). */
  actorUserId: string
  /** Request IP for the audit row. */
  ipAddress: string
}

/**
 * Shift-swap state-machine service (M2 #3, D1 scope).
 *
 * Drives the transition table in {@link swap-state-machine}, enforcing that only legal transitions
 * succeed. On APPROVED it atomically reassigns both shifts' `employeeId` and writes an AuditLog row
 * in a single transaction, after consulting the feasibility validator seam (D2 wires the solver).
 *
 * The tenant `TenantClient` is passed per call (multi-tenant: there is no singleton tenant client) —
 * this mirrors how `AuditService` receives its client. HTTP endpoints + RBAC are M2-D2.
 */
@Injectable()
export class ShiftSwapService {
  constructor(
    @Inject(SWAP_FEASIBILITY_VALIDATOR)
    private readonly feasibility: SwapFeasibilityValidator,
  ) {}

  // --- create + list (M2-D2) ---------------------------------------------------------------------

  /**
   * Create a DRAFT swap request. RBAC: the requester shift MUST belong to the caller's own employee
   * record (a worker only swaps their own shift). A `targetShiftId` makes it a 1:1 swap with that
   * shift's holder; omitting it is a "give away" request (no counterparty).
   */
  async create(
    client: TenantClient,
    actor: SwapActor,
    dto: CreateSwapRequestDto,
  ): Promise<SwapRequestRow> {
    const caller = await this.requireCallerEmployee(client, actor)

    const requesterShift = await client.shift.findUnique({ where: { id: dto.requesterShiftId } })
    if (!requesterShift) throw new NotFoundException(`Shift ${dto.requesterShiftId} not found`)
    if (requesterShift.employeeId !== caller.id) {
      throw new ForbiddenException('You may only request a swap of your own shift')
    }

    let targetEmployeeId: string | null = null
    let targetShiftId: string | null = null
    if (dto.targetShiftId) {
      const targetShift = await client.shift.findUnique({ where: { id: dto.targetShiftId } })
      if (!targetShift) throw new NotFoundException(`Shift ${dto.targetShiftId} not found`)
      if (targetShift.employeeId === caller.id) {
        throw new BadRequestException('Target shift must belong to another employee')
      }
      targetEmployeeId = targetShift.employeeId
      targetShiftId = targetShift.id
    }

    return client.shiftSwapRequest.create({
      data: {
        requesterEmployeeId: caller.id,
        requesterShiftId: requesterShift.id,
        targetEmployeeId,
        targetShiftId,
        state: SwapState.DRAFT,
      },
    })
  }

  /**
   * List swap requests for polling, tenant-scoped by the per-request client and RBAC-scoped by role:
   *  - `mine=true` → requests where the caller is the requester or target;
   *  - HR/ADMIN → all requests;
   *  - MANAGER → requests in a unit they manage (either party), plus their own;
   *  - a plain worker → only their own (requester or target), regardless of `mine`.
   */
  async list(
    client: TenantClient,
    actor: SwapActor,
    filter: { state?: string; mine?: boolean },
  ): Promise<SwapRequestRow[]> {
    const where: Record<string, unknown> = {}
    if (filter.state) where.state = filter.state

    const caller = await this.callerEmployee(client, actor)
    const ownScope: Array<Record<string, unknown>> = caller
      ? [{ requesterEmployeeId: caller.id }, { targetEmployeeId: caller.id }]
      : []

    if (filter.mine) {
      if (!ownScope.length) return []
      where.OR = ownScope
    } else if (!isGlobal(actor.roles)) {
      // Non-global (MANAGER / worker): own requests + any request in a managed unit.
      const managedUnits = await this.managedUnitIds(client, actor.userId)
      const scope: Array<Record<string, unknown>> = [...ownScope]
      if (managedUnits.length) {
        scope.push(
          { requester: { unitId: { in: managedUnits } } },
          { target: { unitId: { in: managedUnits } } },
        )
      }
      if (!scope.length) return []
      where.OR = scope
    }

    return client.shiftSwapRequest.findMany({ where, orderBy: { createdAt: 'desc' } })
  }

  // --- row-level RBAC assertions (M2-D2) ---------------------------------------------------------

  /** Assert the caller's employee is the request's requester (submit / cancel). */
  async assertRequester(client: TenantClient, actor: SwapActor, id: string): Promise<SwapRequestRow> {
    const request = await this.load(client, id)
    const caller = await this.requireCallerEmployee(client, actor)
    if (request.requesterEmployeeId !== caller.id) {
      throw new ForbiddenException('Only the requester may perform this action')
    }
    return request
  }

  /** Assert the caller's employee is the request's target (peer-decision). */
  async assertTarget(client: TenantClient, actor: SwapActor, id: string): Promise<SwapRequestRow> {
    const request = await this.load(client, id)
    const caller = await this.requireCallerEmployee(client, actor)
    if (request.targetEmployeeId !== caller.id) {
      throw new ForbiddenException('Only the swap target may accept or reject')
    }
    return request
  }

  /**
   * Assert the caller may take the manager decision: HR/ADMIN act globally; a MANAGER must manage the
   * unit of the requester or the target (the relevant unit).
   */
  async assertManager(client: TenantClient, actor: SwapActor, id: string): Promise<SwapRequestRow> {
    const request = await this.load(client, id)
    if (isGlobal(actor.roles)) return request

    const managedUnits = await this.managedUnitIds(client, actor.userId)
    if (!managedUnits.length) {
      throw new ForbiddenException('Only a MANAGER of the relevant unit, HR, or ADMIN may decide')
    }
    const partyIds = [request.requesterEmployeeId, request.targetEmployeeId].filter(
      (v): v is string => v !== null,
    )
    const units = await client.employee.findMany({
      where: { id: { in: partyIds } },
      select: { unitId: true },
    })
    if (!units.some((u) => managedUnits.includes(u.unitId))) {
      throw new ForbiddenException('MANAGER may only decide swaps in a unit they manage')
    }
    return request
  }

  /** Unit IDs the user holds a MANAGER role for (via tenant `UserRole`) — mirrors GrafikService. */
  private async managedUnitIds(client: TenantClient, userId: string): Promise<string[]> {
    const rows = await client.userRole.findMany({
      where: { user: { keycloakSub: userId }, role: Role.MANAGER, unitId: { not: null } },
      select: { unitId: true },
    })
    return rows.map((r) => r.unitId).filter((u): u is string => u !== null)
  }

  /** The caller's own Employee (via User.keycloakSub), or null if the user has no employee record. */
  private async callerEmployee(
    client: TenantClient,
    actor: SwapActor,
  ): Promise<{ id: string; unitId: string } | null> {
    return client.employee.findFirst({
      where: { user: { keycloakSub: actor.userId } },
      select: { id: true, unitId: true },
    })
  }

  private async requireCallerEmployee(
    client: TenantClient,
    actor: SwapActor,
  ): Promise<{ id: string; unitId: string }> {
    const caller = await this.callerEmployee(client, actor)
    if (!caller) throw new ForbiddenException('Caller has no employee record in this tenant')
    return caller
  }

  /** DRAFT → PENDING_PEER. */
  async submit(client: TenantClient, id: string): Promise<SwapRequestRow> {
    return this.applyTransition(client, id, SwapAction.Submit)
  }

  /** PENDING_PEER → PEER_AGREED (accept) or REJECTED (reject). */
  async peerDecision(client: TenantClient, id: string, accept: boolean): Promise<SwapRequestRow> {
    return this.applyTransition(client, id, accept ? SwapAction.PeerAccept : SwapAction.PeerReject)
  }

  /** PEER_AGREED → PENDING_MANAGER. */
  async submitToManager(client: TenantClient, id: string): Promise<SwapRequestRow> {
    return this.applyTransition(client, id, SwapAction.SubmitToManager)
  }

  /** Cancel from any pre-terminal state → CANCELLED. */
  async cancel(client: TenantClient, id: string): Promise<SwapRequestRow> {
    return this.applyTransition(client, id, SwapAction.Cancel)
  }

  /**
   * PENDING_MANAGER → APPROVED (approve) or REJECTED (reject).
   *
   * On reject: a plain state transition, no shift is touched (SW4).
   * On approve: consult the feasibility seam, then atomically swap both shifts' `employeeId` and
   * write an AuditLog row in one transaction (SW1).
   */
  async managerDecision(
    client: TenantClient,
    id: string,
    input: ManagerDecisionInput,
  ): Promise<SwapRequestRow> {
    if (!input.approve) {
      return this.applyTransition(client, id, SwapAction.ManagerReject, {
        decidedByManagerId: input.decidedByManagerId,
      })
    }
    return this.approve(client, id, input)
  }

  /**
   * Approve + atomic swap. Validates the transition and feasibility BEFORE any mutation, then in a
   * single transaction: reassigns the shift(s) and writes the audit row. If anything throws, the
   * transaction rolls back and no `Shift` row changes (SW4 holds even on approve failure).
   */
  private async approve(
    client: TenantClient,
    id: string,
    input: ManagerDecisionInput,
  ): Promise<SwapRequestRow> {
    const request = await this.load(client, id)
    // Throws IllegalSwapTransitionError unless state === PENDING_MANAGER.
    const approvedState = nextState(request.state, SwapAction.ManagerApprove)

    // A swap needs a counterparty employee to hand the requester's shift to.
    if (request.targetEmployeeId === null) {
      throw new InvalidSwapTargetError(id)
    }

    const requesterShift = await this.loadShift(client, request.requesterShiftId)
    const targetShift = request.targetShiftId
      ? await this.loadShift(client, request.targetShiftId)
      : null

    // D1 no-op validator (allow-all); D2 swaps in the real solver check (SW2). Runs BEFORE mutation.
    const decision = await this.feasibility.validate({
      client,
      requesterShift: { id: requesterShift.id, employeeId: requesterShift.employeeId },
      targetShift: targetShift ? { id: targetShift.id, employeeId: targetShift.employeeId } : null,
      incomingRequesterShiftEmployeeId: request.targetEmployeeId,
      incomingTargetShiftEmployeeId: targetShift ? request.requesterEmployeeId : null,
    })
    if (!decision.feasible) {
      throw new SwapNotFeasibleError(decision.reason ?? 'unspecified')
    }

    return client.$transaction(async (tx) => {
      // The requester's shift goes to the target employee...
      await tx.shift.update({
        where: { id: requesterShift.id },
        data: { employeeId: request.targetEmployeeId! },
      })
      // ...and, for a 1:1 swap, the target's shift goes to the requester employee.
      if (targetShift) {
        await tx.shift.update({
          where: { id: targetShift.id },
          data: { employeeId: request.requesterEmployeeId },
        })
      }

      const updated = await tx.shiftSwapRequest.update({
        where: { id },
        data: { state: approvedState, decidedByManagerId: input.decidedByManagerId },
      })

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: 'shift_swap.approved',
          entityType: 'ShiftSwapRequest',
          entityId: id,
          payload: {
            requesterEmployeeId: request.requesterEmployeeId,
            requesterShiftId: request.requesterShiftId,
            targetEmployeeId: request.targetEmployeeId,
            targetShiftId: request.targetShiftId,
            decidedByManagerId: input.decidedByManagerId,
          } as Parameters<typeof tx.auditLog.create>[0]['data']['payload'],
          ipAddress: input.ipAddress,
        },
      })

      return updated
    })
  }

  /**
   * Generic transition: load → compute next state (throws if illegal) → persist. Used for every
   * transition except approve, which needs the atomic swap + audit transaction above.
   */
  private async applyTransition(
    client: TenantClient,
    id: string,
    action: SwapAction,
    extraData: Partial<Pick<SwapRequestRow, 'decidedByManagerId'>> = {},
  ): Promise<SwapRequestRow> {
    const request = await this.load(client, id)
    const to = nextState(request.state, action)
    return client.shiftSwapRequest.update({
      where: { id },
      data: { state: to, ...extraData },
    })
  }

  private async load(client: TenantClient, id: string): Promise<SwapRequestRow> {
    const request = await client.shiftSwapRequest.findUnique({ where: { id } })
    if (!request) {
      throw new SwapRequestNotFoundError(id)
    }
    return request
  }

  private async loadShift(client: TenantClient, id: string) {
    const shift = await client.shift.findUnique({ where: { id } })
    if (!shift) {
      // A dangling FK should be impossible (RESTRICT), but guard rather than silently no-op.
      throw new Error(`Shift not found for swap: ${id}`)
    }
    return shift
  }
}
