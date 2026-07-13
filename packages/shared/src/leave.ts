/**
 * Leave (urlop / Wnioski) domain enums + the pure LeaveRequest state machine, and the Dostępy
 * (AccessGrant) domain enums (M2 core-modules Phase 0).
 *
 * Prisma cannot import TS, so — following the repo convention for `Role`/`EmploymentType`/
 * `AutonomyLevel` (`@hrobot/shared`) — the enum values below are hand-kept in sync with the Prisma
 * `enum` blocks in `packages/db/prisma/tenant/schema.prisma`; `packages/db/src/enumParity.test.ts`
 * fails loudly on any drift. `LeaveAction` is an action enum (not a Prisma enum) and intentionally
 * has NO parity assertion.
 *
 *   PENDING ─approve→ APPROVED
 *   PENDING ─reject→  REJECTED
 *   PENDING ─cancel→  CANCELLED
 *   (APPROVED, REJECTED, CANCELLED are terminal — no outgoing transitions)
 */

/** Lifecycle status of a leave request. Mirrors the Prisma `LeaveStatus` enum. */
export const LeaveStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const
export type LeaveStatus = (typeof LeaveStatus)[keyof typeof LeaveStatus]

/** Kind of physical/logical access grant (Dostępy). Mirrors the Prisma `AccessType` enum. */
export const AccessType = {
  CARD: 'CARD',
  KEY: 'KEY',
  PERMISSION: 'PERMISSION',
} as const
export type AccessType = (typeof AccessType)[keyof typeof AccessType]

/** Lifecycle status of an AccessGrant. Mirrors the Prisma `AccessStatus` enum. */
export const AccessStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  LOST: 'LOST',
} as const
export type AccessStatus = (typeof AccessStatus)[keyof typeof AccessStatus]

/** The actions that drive the leave-request machine. Not a Prisma enum — no parity assertion. */
export enum LeaveAction {
  Approve = 'approve',
  Reject = 'reject',
  Cancel = 'cancel',
}

/** Terminal states — no outgoing transitions. */
export const LEAVE_TERMINAL_STATES: ReadonlySet<LeaveStatus> = new Set([
  LeaveStatus.APPROVED,
  LeaveStatus.REJECTED,
  LeaveStatus.CANCELLED,
])

/**
 * Explicit transition table: `LEAVE_TRANSITIONS[from][action] = to`. An action absent for a given
 * `from` state is illegal. All three actions are only legal from PENDING; every other state is
 * terminal (empty transition set).
 */
export const LEAVE_TRANSITIONS: Readonly<
  Record<LeaveStatus, Partial<Record<LeaveAction, LeaveStatus>>>
> = {
  [LeaveStatus.PENDING]: {
    [LeaveAction.Approve]: LeaveStatus.APPROVED,
    [LeaveAction.Reject]: LeaveStatus.REJECTED,
    [LeaveAction.Cancel]: LeaveStatus.CANCELLED,
  },
  [LeaveStatus.APPROVED]: {},
  [LeaveStatus.REJECTED]: {},
  [LeaveStatus.CANCELLED]: {},
}

/** Thrown when an action is not legal from the current state (per the transition table). */
export class IllegalLeaveTransitionError extends Error {
  constructor(
    public readonly from: LeaveStatus,
    public readonly action: LeaveAction,
  ) {
    super(`Illegal leave transition: cannot ${action} from ${from}`)
    this.name = 'IllegalLeaveTransitionError'
  }
}

/**
 * Pure transition function. Returns the next state for `(from, action)` or throws
 * `IllegalLeaveTransitionError` if the action is not permitted from `from`.
 */
export function nextLeaveState(from: LeaveStatus, action: LeaveAction): LeaveStatus {
  const to = LEAVE_TRANSITIONS[from][action]
  if (to === undefined) {
    throw new IllegalLeaveTransitionError(from, action)
  }
  return to
}
