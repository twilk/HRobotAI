import { Inject, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import {
  SwapAction,
  SwapRequestNotFoundError,
  SwapNotFeasibleError,
  InvalidSwapTargetError,
  nextState,
} from './swap-state-machine.js'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  type SwapFeasibilityValidator,
} from './swap-feasibility-validator.js'

/** A persisted ShiftSwapRequest row (all scalar fields), derived from the client return type. */
type SwapRequestRow = NonNullable<
  Awaited<ReturnType<TenantClient['shiftSwapRequest']['findUnique']>>
>

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
