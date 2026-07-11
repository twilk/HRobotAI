import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SwapAction,
  SwapState,
  IllegalSwapTransitionError,
  TERMINAL_STATES,
  nextState,
} from './swap-state-machine.js'

/** The complete set of legal transitions the machine must permit (M2 #3 §4). */
const LEGAL: ReadonlyArray<[SwapState, SwapAction, SwapState]> = [
  [SwapState.DRAFT, SwapAction.Submit, SwapState.PENDING_PEER],
  [SwapState.DRAFT, SwapAction.Cancel, SwapState.CANCELLED],
  [SwapState.PENDING_PEER, SwapAction.PeerAccept, SwapState.PEER_AGREED],
  [SwapState.PENDING_PEER, SwapAction.PeerReject, SwapState.REJECTED],
  [SwapState.PENDING_PEER, SwapAction.Cancel, SwapState.CANCELLED],
  [SwapState.PEER_AGREED, SwapAction.SubmitToManager, SwapState.PENDING_MANAGER],
  [SwapState.PEER_AGREED, SwapAction.Cancel, SwapState.CANCELLED],
  [SwapState.PENDING_MANAGER, SwapAction.ManagerApprove, SwapState.APPROVED],
  [SwapState.PENDING_MANAGER, SwapAction.ManagerReject, SwapState.REJECTED],
  [SwapState.PENDING_MANAGER, SwapAction.Cancel, SwapState.CANCELLED],
]

describe('swap-state-machine transition table', () => {
  it.each(LEGAL)('permits %s ─%s→ %s', (from, action, expected) => {
    expect(nextState(from, action)).toBe(expected)
  })

  it('rejects every transition not in the legal table', () => {
    const legalKeys = new Set(LEGAL.map(([from, action]) => `${from}:${action}`))
    const allStates = Object.values(SwapState)
    const allActions = Object.values(SwapAction)

    for (const from of allStates) {
      for (const action of allActions) {
        if (legalKeys.has(`${from}:${action}`)) continue
        expect(() => nextState(from, action)).toThrow(IllegalSwapTransitionError)
      }
    }
  })

  it.each([
    [SwapState.DRAFT, SwapAction.ManagerApprove],
    [SwapState.DRAFT, SwapAction.PeerAccept],
    [SwapState.PENDING_PEER, SwapAction.Submit],
    [SwapState.PEER_AGREED, SwapAction.PeerAccept],
    [SwapState.PENDING_MANAGER, SwapAction.Submit],
  ] as const)('rejects representative illegal %s ─%s→', (from, action) => {
    expect(() => nextState(from, action)).toThrow(IllegalSwapTransitionError)
  })

  it.each([...TERMINAL_STATES])('treats %s as terminal (no outgoing transition)', (terminal) => {
    for (const action of Object.values(SwapAction)) {
      expect(() => nextState(terminal, action)).toThrow(IllegalSwapTransitionError)
    }
  })
})

// Parity guard: the hand-maintained TS `SwapState` enum must match the Prisma `enum SwapState`
// block (Prisma can't import TS). Mirrors packages/db/src/enumParity.test.ts.
describe('SwapState enum parity with Prisma schema', () => {
  it('TS SwapState values equal the schema enum values', () => {
    const schemaPath = resolve(__dirname, '../../../../packages/db/prisma/tenant/schema.prisma')
    const src = readFileSync(schemaPath, 'utf8')
    const match = /enum\s+SwapState\s*\{([^}]*)\}/.exec(src)
    expect(match).not.toBeNull()
    const schemaValues = match![1]!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@'))
      .sort()
    expect(schemaValues).toEqual([...Object.values(SwapState)].sort())
  })
})
