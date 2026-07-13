import {
  LeaveAction,
  LeaveStatus,
  LEAVE_TERMINAL_STATES,
  IllegalLeaveTransitionError,
  nextLeaveState,
} from './leave.js'

/** The complete set of legal transitions the machine must permit (M2 core-modules Phase 0). */
const LEGAL: ReadonlyArray<[LeaveStatus, LeaveAction, LeaveStatus]> = [
  [LeaveStatus.PENDING, LeaveAction.Approve, LeaveStatus.APPROVED],
  [LeaveStatus.PENDING, LeaveAction.Reject, LeaveStatus.REJECTED],
  [LeaveStatus.PENDING, LeaveAction.Cancel, LeaveStatus.CANCELLED],
]

describe('leave request state machine', () => {
  it.each(LEGAL)('permits %s ─%s→ %s', (from, action, expected) => {
    expect(nextLeaveState(from, action)).toBe(expected)
  })

  it('throws IllegalLeaveTransitionError on an illegal transition', () => {
    expect(() => nextLeaveState(LeaveStatus.APPROVED, LeaveAction.Approve)).toThrow(
      IllegalLeaveTransitionError,
    )
  })

  it('rejects every transition not in the legal table', () => {
    const legalKeys = new Set(LEGAL.map(([from, action]) => `${from}:${action}`))
    const allStates = Object.values(LeaveStatus)
    const allActions = Object.values(LeaveAction)

    for (const from of allStates) {
      for (const action of allActions) {
        if (legalKeys.has(`${from}:${action}`)) continue
        expect(() => nextLeaveState(from, action)).toThrow(IllegalLeaveTransitionError)
      }
    }
  })

  it.each([...LEAVE_TERMINAL_STATES])('treats %s as terminal (no outgoing transition)', (terminal) => {
    for (const action of Object.values(LeaveAction)) {
      expect(() => nextLeaveState(terminal, action)).toThrow(IllegalLeaveTransitionError)
    }
  })

  it('error carries the offending from/action', () => {
    try {
      nextLeaveState(LeaveStatus.REJECTED, LeaveAction.Cancel)
      throw new Error('expected nextLeaveState to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalLeaveTransitionError)
      const illegal = err as IllegalLeaveTransitionError
      expect(illegal.from).toBe(LeaveStatus.REJECTED)
      expect(illegal.action).toBe(LeaveAction.Cancel)
    }
  })
})
