import { Injectable, Logger } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'

/** Minimal view of a Shift the feasibility check needs (id + current holder). */
export interface SwapShiftRef {
  id: string
  employeeId: string
}

/**
 * Solver-validation SEAM (M2 #3, criterion SW2). Before an APPROVED swap mutates any `Shift`,
 * the service asks this port whether the resulting schedule stays feasible — i.e. does not break
 * the hard constraints H1–H6 (rest, qualifications, no overlap, …).
 *
 * D1 ships only the port + a permissive default (`AllowAllSwapFeasibilityValidator`). D2 replaces
 * the provider with the real optimizer client; NOTHING in D1 calls the solver.
 */
export interface SwapFeasibilityInput {
  /**
   * The per-request tenant client. The real (D2) validator uses it to pack the affected employees'
   * post-swap shifts for the affected week and load their qualifications; the D1 allow-all default
   * ignores it. Multi-tenant: there is no singleton tenant client, so the seam receives it per call.
   */
  client: TenantClient
  /** The requester's shift as it exists today (pre-swap). */
  requesterShift: SwapShiftRef
  /** The target's shift for a 1:1 swap, or null for a "give away shift" request. */
  targetShift: SwapShiftRef | null
  /** Employee who will hold the requester's shift after the swap (the target). */
  incomingRequesterShiftEmployeeId: string
  /** Employee who will hold the target's shift after the swap (the requester); null for give-away. */
  incomingTargetShiftEmployeeId: string | null
}

export interface SwapFeasibilityDecision {
  feasible: boolean
  /** Human-readable reason when `feasible` is false (e.g. "H2 rest window violated"). */
  reason?: string
}

export interface SwapFeasibilityValidator {
  validate(input: SwapFeasibilityInput): Promise<SwapFeasibilityDecision>
}

/** DI token for the feasibility validator port. D2 rebinds this to the real optimizer client. */
export const SWAP_FEASIBILITY_VALIDATOR = Symbol('SWAP_FEASIBILITY_VALIDATOR')

/**
 * D1 default: allow every swap. This is the wiring point for M2-D2 — DO NOT call the optimizer
 * here. D2 provides a validator that runs the swapped schedule through the solver (#1) and
 * returns `{ feasible: false }` when H1–H6 would break (criterion SW2).
 */
@Injectable()
export class AllowAllSwapFeasibilityValidator implements SwapFeasibilityValidator {
  private readonly logger = new Logger(AllowAllSwapFeasibilityValidator.name)

  async validate(_input: SwapFeasibilityInput): Promise<SwapFeasibilityDecision> {
    this.logger.debug('D1 no-op feasibility validator: allowing swap (real solver check is D2)')
    return { feasible: true }
  }
}
