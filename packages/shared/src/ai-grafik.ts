/**
 * AI-scheduling ("Grafik AI") domain enums + the pure AiProposal state machine (M2 §AI).
 *
 * Prisma cannot import TS, so — following the repo convention for `Role`/`EmploymentType`/`SwapState`
 * (`@hrobot/shared`) — the enum values below are hand-kept in sync with the Prisma `enum` blocks in
 * `packages/db/prisma/tenant/schema.prisma`; `packages/db/src/enumParity.test.ts` fails loudly on
 * any drift. This module owns the single source of truth for legal proposal-state transitions.
 *
 *   DRAFT ─ask_consent→ PENDING_EMPLOYEE_CONSENT ─employee_accept→ EMPLOYEE_AGREED
 *      │  ─submit_to_manager→ PENDING_MANAGER ←─submit_to_manager── EMPLOYEE_AGREED
 *      │  ─direct_escalate→ ESCALATED
 *      │        PENDING_EMPLOYEE_CONSENT ─employee_decline_next→ (self-loop; service promotes next
 *      │        candidate) / ─employee_decline_last | expire | direct_escalate→ ESCALATED
 *      │  PENDING_MANAGER ─manager_approve→ APPROVED / ─manager_reject→ REJECTED
 *      └── cancel (any non-terminal) → CANCELLED
 */

/** Autonomy level configured per tenant/facility. Mirrors the Prisma `AutonomyLevel` enum. */
export const AutonomyLevel = {
  SUGGEST_ONLY: 'SUGGEST_ONLY',
  AUTO_NOTIFY: 'AUTO_NOTIFY',
  AUTO_ASK_CONSENT: 'AUTO_ASK_CONSENT',
  AUTO_COMMIT_ON_APPROVAL: 'AUTO_COMMIT_ON_APPROVAL',
} as const
export type AutonomyLevel = (typeof AutonomyLevel)[keyof typeof AutonomyLevel]

/** Kind of AI proposal. Mirrors the Prisma `AiProposalType` enum. */
export const AiProposalType = {
  REPLACEMENT: 'REPLACEMENT',
  ADHOC: 'ADHOC',
  CAPACITY: 'CAPACITY',
} as const
export type AiProposalType = (typeof AiProposalType)[keyof typeof AiProposalType]

/** Lifecycle state of an AI proposal. Mirrors the Prisma `AiProposalState` enum. */
export const AiProposalState = {
  DRAFT: 'DRAFT',
  PENDING_EMPLOYEE_CONSENT: 'PENDING_EMPLOYEE_CONSENT',
  EMPLOYEE_AGREED: 'EMPLOYEE_AGREED',
  PENDING_MANAGER: 'PENDING_MANAGER',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ESCALATED: 'ESCALATED',
  CANCELLED: 'CANCELLED',
} as const
export type AiProposalState = (typeof AiProposalState)[keyof typeof AiProposalState]

/** Per-candidate consent status. Mirrors the Prisma `ConsentState` enum. */
export const ConsentState = {
  NOT_ASKED: 'NOT_ASKED',
  PENDING: 'PENDING',
  GRANTED: 'GRANTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
} as const
export type ConsentState = (typeof ConsentState)[keyof typeof ConsentState]

/** The actions that drive the proposal machine. Employee/manager decisions fan out here. */
export enum AiProposalAction {
  AskConsent = 'ask_consent',
  SubmitToManager = 'submit_to_manager',
  EmployeeAccept = 'employee_accept',
  /** Candidate declined but another candidate remains — service promotes the next one. */
  EmployeeDeclineNext = 'employee_decline_next',
  /** Last candidate declined — no one left to ask. */
  EmployeeDeclineLast = 'employee_decline_last',
  Expire = 'expire',
  ManagerApprove = 'manager_approve',
  ManagerReject = 'manager_reject',
  DirectEscalate = 'direct_escalate',
  Cancel = 'cancel',
}

/** Terminal states — no outgoing transitions. */
export const AI_TERMINAL_STATES: ReadonlySet<AiProposalState> = new Set([
  AiProposalState.APPROVED,
  AiProposalState.REJECTED,
  AiProposalState.CANCELLED,
  AiProposalState.ESCALATED,
])

/**
 * Explicit transition table: `AI_TRANSITIONS[from][action] = to`. An action absent for a given
 * `from` state is illegal. `cancel` is available from every non-terminal state.
 */
export const AI_TRANSITIONS: Readonly<
  Record<AiProposalState, Partial<Record<AiProposalAction, AiProposalState>>>
> = {
  [AiProposalState.DRAFT]: {
    [AiProposalAction.AskConsent]: AiProposalState.PENDING_EMPLOYEE_CONSENT,
    [AiProposalAction.SubmitToManager]: AiProposalState.PENDING_MANAGER,
    [AiProposalAction.DirectEscalate]: AiProposalState.ESCALATED,
    [AiProposalAction.Cancel]: AiProposalState.CANCELLED,
  },
  [AiProposalState.PENDING_EMPLOYEE_CONSENT]: {
    [AiProposalAction.EmployeeAccept]: AiProposalState.EMPLOYEE_AGREED,
    [AiProposalAction.EmployeeDeclineNext]: AiProposalState.PENDING_EMPLOYEE_CONSENT,
    [AiProposalAction.EmployeeDeclineLast]: AiProposalState.ESCALATED,
    [AiProposalAction.Expire]: AiProposalState.ESCALATED,
    [AiProposalAction.DirectEscalate]: AiProposalState.ESCALATED,
    [AiProposalAction.Cancel]: AiProposalState.CANCELLED,
  },
  [AiProposalState.EMPLOYEE_AGREED]: {
    [AiProposalAction.SubmitToManager]: AiProposalState.PENDING_MANAGER,
    [AiProposalAction.Cancel]: AiProposalState.CANCELLED,
  },
  [AiProposalState.PENDING_MANAGER]: {
    [AiProposalAction.ManagerApprove]: AiProposalState.APPROVED,
    [AiProposalAction.ManagerReject]: AiProposalState.REJECTED,
    [AiProposalAction.Cancel]: AiProposalState.CANCELLED,
  },
  [AiProposalState.APPROVED]: {},
  [AiProposalState.REJECTED]: {},
  [AiProposalState.ESCALATED]: {},
  [AiProposalState.CANCELLED]: {},
}

/** Thrown when an action is not legal from the current state (per the transition table). */
export class IllegalAiProposalTransitionError extends Error {
  constructor(
    public readonly from: AiProposalState,
    public readonly action: AiProposalAction,
  ) {
    super(`Illegal AI proposal transition: cannot ${action} from ${from}`)
    this.name = 'IllegalAiProposalTransitionError'
  }
}

/**
 * Pure transition function. Returns the next state for `(from, action)` or throws
 * `IllegalAiProposalTransitionError` if the action is not permitted from `from`.
 */
export function nextProposalState(
  from: AiProposalState,
  action: AiProposalAction,
): AiProposalState {
  const to = AI_TRANSITIONS[from][action]
  if (to === undefined) {
    throw new IllegalAiProposalTransitionError(from, action)
  }
  return to
}
