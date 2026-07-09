/**
 * Shift-swap state machine (M2 #3 §4). Fresh implementation — the spec references a `wnioski`
 * (LeaveRequest) pattern that does NOT exist in this repo, so the transition table below is the
 * single source of truth for legal transitions. Endpoints/RBAC that drive these actions land in
 * M2-D2; D1 owns the model + this machine + the atomic approve-swap.
 *
 *   DRAFT ─submit→ PENDING_PEER ─peer accept→ PEER_AGREED ─submit to mgr→ PENDING_MANAGER ─approve→ APPROVED
 *      │                │ peer reject→ REJECTED                                  │ reject→ REJECTED
 *      └── cancel (any pre-terminal) → CANCELLED
 */

/**
 * Domain enum mirroring the Prisma `SwapState` enum. Prisma cannot import TS, so — following the
 * repo convention for `Role`/`EmploymentType` (`@hrobot/shared`) — the values are hand-kept in
 * sync with `schema.prisma`; `swap-state-machine.spec.ts` fails loudly on any drift.
 */
export const SwapState = {
  DRAFT: 'DRAFT',
  PENDING_PEER: 'PENDING_PEER',
  PEER_AGREED: 'PEER_AGREED',
  PENDING_MANAGER: 'PENDING_MANAGER',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const
export type SwapState = (typeof SwapState)[keyof typeof SwapState]

/** The actions that drive the machine. `peer`/`manager` decisions fan out to accept/reject here. */
export enum SwapAction {
  Submit = 'submit',
  PeerAccept = 'peer_accept',
  PeerReject = 'peer_reject',
  SubmitToManager = 'submit_to_manager',
  ManagerApprove = 'manager_approve',
  ManagerReject = 'manager_reject',
  Cancel = 'cancel',
}

/** Terminal states — no outgoing transitions. */
export const TERMINAL_STATES: ReadonlySet<SwapState> = new Set([
  SwapState.APPROVED,
  SwapState.REJECTED,
  SwapState.CANCELLED,
])

/**
 * Explicit transition table: `TRANSITIONS[from][action] = to`. An action absent for a given
 * `from` state is illegal. `cancel` is available from every pre-terminal state.
 */
export const TRANSITIONS: Readonly<
  Record<SwapState, Partial<Record<SwapAction, SwapState>>>
> = {
  [SwapState.DRAFT]: {
    [SwapAction.Submit]: SwapState.PENDING_PEER,
    [SwapAction.Cancel]: SwapState.CANCELLED,
  },
  [SwapState.PENDING_PEER]: {
    [SwapAction.PeerAccept]: SwapState.PEER_AGREED,
    [SwapAction.PeerReject]: SwapState.REJECTED,
    [SwapAction.Cancel]: SwapState.CANCELLED,
  },
  [SwapState.PEER_AGREED]: {
    [SwapAction.SubmitToManager]: SwapState.PENDING_MANAGER,
    [SwapAction.Cancel]: SwapState.CANCELLED,
  },
  [SwapState.PENDING_MANAGER]: {
    [SwapAction.ManagerApprove]: SwapState.APPROVED,
    [SwapAction.ManagerReject]: SwapState.REJECTED,
    [SwapAction.Cancel]: SwapState.CANCELLED,
  },
  [SwapState.APPROVED]: {},
  [SwapState.REJECTED]: {},
  [SwapState.CANCELLED]: {},
}

/** Thrown when a request id resolves to no row. */
export class SwapRequestNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`ShiftSwapRequest not found: ${id}`)
    this.name = 'SwapRequestNotFoundError'
  }
}

/** Thrown when an action is not legal from the current state (per the transition table). */
export class IllegalSwapTransitionError extends Error {
  constructor(
    public readonly from: SwapState,
    public readonly action: SwapAction,
  ) {
    super(`Illegal shift-swap transition: cannot ${action} from ${from}`)
    this.name = 'IllegalSwapTransitionError'
  }
}

/** Thrown when the feasibility validator (D2 solver seam) rejects the swap. */
export class SwapNotFeasibleError extends Error {
  constructor(public readonly reason: string) {
    super(`Shift swap rejected by feasibility validation: ${reason}`)
    this.name = 'SwapNotFeasibleError'
  }
}

/** Thrown when approving a request that has no counterparty to move the shift to. */
export class InvalidSwapTargetError extends Error {
  constructor(public readonly id: string) {
    super(`ShiftSwapRequest ${id} has no target employee to swap/give the shift to`)
    this.name = 'InvalidSwapTargetError'
  }
}

/**
 * Pure transition function. Returns the next state for `(from, action)` or throws
 * `IllegalSwapTransitionError` if the action is not permitted from `from`.
 */
export function nextState(from: SwapState, action: SwapAction): SwapState {
  const to = TRANSITIONS[from][action]
  if (to === undefined) {
    throw new IllegalSwapTransitionError(from, action)
  }
  return to
}
