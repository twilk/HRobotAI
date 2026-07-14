import {
  AiProposalAction,
  AiProposalState,
  AI_TERMINAL_STATES,
  IllegalAiProposalTransitionError,
  nextProposalState,
} from './ai-grafik.js'

/** The complete set of legal transitions the machine must permit (M2 §AI). */
const LEGAL: ReadonlyArray<[AiProposalState, AiProposalAction, AiProposalState]> = [
  [AiProposalState.DRAFT, AiProposalAction.AskConsent, AiProposalState.PENDING_EMPLOYEE_CONSENT],
  [AiProposalState.DRAFT, AiProposalAction.SubmitToManager, AiProposalState.PENDING_MANAGER],
  [AiProposalState.DRAFT, AiProposalAction.DirectEscalate, AiProposalState.ESCALATED],
  [AiProposalState.DRAFT, AiProposalAction.Cancel, AiProposalState.CANCELLED],
  [
    AiProposalState.PENDING_EMPLOYEE_CONSENT,
    AiProposalAction.EmployeeAccept,
    AiProposalState.EMPLOYEE_AGREED,
  ],
  [
    AiProposalState.PENDING_EMPLOYEE_CONSENT,
    AiProposalAction.EmployeeDeclineNext,
    AiProposalState.PENDING_EMPLOYEE_CONSENT,
  ],
  [
    AiProposalState.PENDING_EMPLOYEE_CONSENT,
    AiProposalAction.EmployeeDeclineLast,
    AiProposalState.ESCALATED,
  ],
  [AiProposalState.PENDING_EMPLOYEE_CONSENT, AiProposalAction.Expire, AiProposalState.ESCALATED],
  [
    AiProposalState.PENDING_EMPLOYEE_CONSENT,
    AiProposalAction.DirectEscalate,
    AiProposalState.ESCALATED,
  ],
  [AiProposalState.PENDING_EMPLOYEE_CONSENT, AiProposalAction.Cancel, AiProposalState.CANCELLED],
  [
    AiProposalState.EMPLOYEE_AGREED,
    AiProposalAction.SubmitToManager,
    AiProposalState.PENDING_MANAGER,
  ],
  [AiProposalState.EMPLOYEE_AGREED, AiProposalAction.Cancel, AiProposalState.CANCELLED],
  [AiProposalState.PENDING_MANAGER, AiProposalAction.ManagerApprove, AiProposalState.APPROVED],
  [AiProposalState.PENDING_MANAGER, AiProposalAction.ManagerReject, AiProposalState.REJECTED],
  [AiProposalState.PENDING_MANAGER, AiProposalAction.Cancel, AiProposalState.CANCELLED],
]

describe('ai-grafik proposal state machine', () => {
  it.each(LEGAL)('permits %s ─%s→ %s', (from, action, expected) => {
    expect(nextProposalState(from, action)).toBe(expected)
  })

  it('self-loops on employee_decline_next (service promotes the next candidate)', () => {
    expect(
      nextProposalState(
        AiProposalState.PENDING_EMPLOYEE_CONSENT,
        AiProposalAction.EmployeeDeclineNext,
      ),
    ).toBe(AiProposalState.PENDING_EMPLOYEE_CONSENT)
  })

  it('escalates on employee_decline_last (no candidate left to ask)', () => {
    expect(
      nextProposalState(
        AiProposalState.PENDING_EMPLOYEE_CONSENT,
        AiProposalAction.EmployeeDeclineLast,
      ),
    ).toBe(AiProposalState.ESCALATED)
  })

  it('escalates on expire from PENDING_EMPLOYEE_CONSENT', () => {
    expect(
      nextProposalState(AiProposalState.PENDING_EMPLOYEE_CONSENT, AiProposalAction.Expire),
    ).toBe(AiProposalState.ESCALATED)
  })

  it('allows DRAFT to submit straight to the manager', () => {
    expect(nextProposalState(AiProposalState.DRAFT, AiProposalAction.SubmitToManager)).toBe(
      AiProposalState.PENDING_MANAGER,
    )
  })

  it('throws IllegalAiProposalTransitionError on an illegal transition', () => {
    expect(() =>
      nextProposalState(AiProposalState.DRAFT, AiProposalAction.ManagerApprove),
    ).toThrow(IllegalAiProposalTransitionError)
  })

  it('rejects every transition not in the legal table', () => {
    const legalKeys = new Set(LEGAL.map(([from, action]) => `${from}:${action}`))
    const allStates = Object.values(AiProposalState)
    const allActions = Object.values(AiProposalAction)

    for (const from of allStates) {
      for (const action of allActions) {
        if (legalKeys.has(`${from}:${action}`)) continue
        expect(() => nextProposalState(from, action)).toThrow(IllegalAiProposalTransitionError)
      }
    }
  })

  it.each([...AI_TERMINAL_STATES])(
    'treats %s as terminal (no outgoing transition)',
    (terminal) => {
      for (const action of Object.values(AiProposalAction)) {
        expect(() => nextProposalState(terminal, action)).toThrow(IllegalAiProposalTransitionError)
      }
    },
  )
})
