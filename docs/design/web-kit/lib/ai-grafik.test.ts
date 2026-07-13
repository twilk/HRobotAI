import { describe, expect, it } from 'vitest'
import {
  autonomyLabel,
  validateQuietHours,
  AUTONOMY_LEVELS,
  aiProposalActions,
  proposalStateLabel,
  isMineToConsent,
  type AiProposal,
  type AiProposalState,
} from './ai-grafik'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node', so these cover only the pure
// helpers the AI-config panel relies on: the Polish autonomy labels and the quiet-hours validation
// that gates the PATCH. No PII, no network — pure functions.

describe('autonomyLabel', () => {
  it('maps every autonomy level to a distinct Polish label', () => {
    expect(autonomyLabel('SUGGEST_ONLY')).toBe('Tylko sugestie')
    expect(autonomyLabel('AUTO_NOTIFY')).toBe('Automatycznie z powiadomieniem')
    expect(autonomyLabel('AUTO_ASK_CONSENT')).toBe('Automatycznie za zgodą pracownika')
    expect(autonomyLabel('AUTO_COMMIT_ON_APPROVAL')).toBe('Automatycznie po zatwierdzeniu')
  })

  it('covers all four enum values with unique labels', () => {
    const labels = AUTONOMY_LEVELS.map(autonomyLabel)
    expect(AUTONOMY_LEVELS).toHaveLength(4)
    expect(new Set(labels).size).toBe(4)
  })
})

describe('validateQuietHours', () => {
  it('accepts both-empty (feature off), tolerating whitespace', () => {
    expect(validateQuietHours('', '')).toBe(true)
    expect(validateQuietHours('  ', ' ')).toBe(true)
  })

  it('accepts a well-formed HH:mm window on both bounds', () => {
    expect(validateQuietHours('22:00', '06:00')).toBe(true)
    expect(validateQuietHours('00:00', '23:59')).toBe(true)
    expect(validateQuietHours(' 08:30 ', ' 17:45 ')).toBe(true)
  })

  it('rejects a one-sided window', () => {
    expect(validateQuietHours('22:00', '')).toBe(false)
    expect(validateQuietHours('', '06:00')).toBe(false)
  })

  it('rejects malformed times', () => {
    expect(validateQuietHours('24:00', '06:00')).toBe(false)
    expect(validateQuietHours('9:00', '17:00')).toBe(false)
    expect(validateQuietHours('22:60', '06:00')).toBe(false)
    expect(validateQuietHours('abc', 'def')).toBe(false)
  })

  it('enforces a real 24h range, not just digit-shape', () => {
    expect(validateQuietHours('25:70', '06:00')).toBe(false)
    expect(validateQuietHours('99:99', '06:00')).toBe(false)
    expect(validateQuietHours('08:30', '17:45')).toBe(true)
  })
})

// --- AI proposal inbox pure helpers (Task 1.5) ----------------------------------------------------
// No network, no PII: aiProposalActions/proposalStateLabel/isMineToConsent are pure functions over
// already-fetched proposal shapes.

const ALL_STATES: AiProposalState[] = [
  'DRAFT',
  'PENDING_EMPLOYEE_CONSENT',
  'EMPLOYEE_AGREED',
  'PENDING_MANAGER',
  'APPROVED',
  'REJECTED',
  'ESCALATED',
  'CANCELLED',
]

describe('proposalStateLabel', () => {
  it('maps every lifecycle state to a distinct Polish label', () => {
    const labels = ALL_STATES.map(proposalStateLabel)
    expect(new Set(labels).size).toBe(ALL_STATES.length)
  })

  it('echoes an unknown value back rather than throwing', () => {
    expect(proposalStateLabel('SOMETHING_UNKNOWN' as AiProposalState)).toBe('SOMETHING_UNKNOWN')
  })
})

describe('aiProposalActions', () => {
  it('gives a manager approve/reject only in PENDING_MANAGER', () => {
    expect(aiProposalActions('PENDING_MANAGER', 'manager')).toEqual([
      { action: 'approve', label: 'Zatwierdź' },
      { action: 'reject', label: 'Odrzuć' },
    ])
    expect(aiProposalActions('DRAFT', 'manager')).toEqual([])
    expect(aiProposalActions('PENDING_EMPLOYEE_CONSENT', 'manager')).toEqual([])
    expect(aiProposalActions('ESCALATED', 'manager')).toEqual([])
  })

  it('gives the active employee accept/decline only in PENDING_EMPLOYEE_CONSENT', () => {
    expect(aiProposalActions('PENDING_EMPLOYEE_CONSENT', 'employee')).toEqual([
      { action: 'accept', label: 'Akceptuj' },
      { action: 'decline', label: 'Odrzuć' },
    ])
    expect(aiProposalActions('PENDING_MANAGER', 'employee')).toEqual([])
    expect(aiProposalActions('EMPLOYEE_AGREED', 'employee')).toEqual([])
  })

  it('offers nothing for every terminal state, regardless of role', () => {
    for (const state of ['APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED'] as AiProposalState[]) {
      expect(aiProposalActions(state, 'manager')).toEqual([])
      expect(aiProposalActions(state, 'employee')).toEqual([])
    }
  })

  it('offers nothing when the caller has no relationship to the proposal', () => {
    expect(aiProposalActions('PENDING_MANAGER', null)).toEqual([])
    expect(aiProposalActions('PENDING_EMPLOYEE_CONSENT', null)).toEqual([])
  })
})

describe('isMineToConsent', () => {
  function proposal(overrides: Partial<Pick<AiProposal, 'state' | 'activeCandidateId' | 'candidates'>> = {}) {
    const base: Pick<AiProposal, 'state' | 'activeCandidateId' | 'candidates'> = {
      state: 'PENDING_EMPLOYEE_CONSENT',
      activeCandidateId: 'cand-1',
      candidates: [
        {
          id: 'cand-1',
          employeeId: 'emp-1',
          rank: 1,
          feasible: true,
          consentState: 'PENDING',
        },
        {
          id: 'cand-2',
          employeeId: 'emp-2',
          rank: 2,
          feasible: true,
          consentState: 'NOT_ASKED',
        },
      ],
    }
    return { ...base, ...overrides }
  }

  it('is true for the active candidate while PENDING in PENDING_EMPLOYEE_CONSENT', () => {
    expect(isMineToConsent(proposal(), 'emp-1')).toBe(true)
  })

  it('is false for a non-active employee', () => {
    expect(isMineToConsent(proposal(), 'emp-2')).toBe(false)
    expect(isMineToConsent(proposal(), 'emp-unrelated')).toBe(false)
  })

  it('is false when the caller has no employee record', () => {
    expect(isMineToConsent(proposal(), null)).toBe(false)
  })

  it('is false once the proposal has moved past PENDING_EMPLOYEE_CONSENT', () => {
    expect(isMineToConsent(proposal({ state: 'PENDING_MANAGER' }), 'emp-1')).toBe(false)
    expect(isMineToConsent(proposal({ state: 'EMPLOYEE_AGREED' }), 'emp-1')).toBe(false)
  })

  it('is false once the active candidate has already answered (not PENDING anymore)', () => {
    const p = proposal({
      candidates: [
        { id: 'cand-1', employeeId: 'emp-1', rank: 1, feasible: true, consentState: 'GRANTED' },
        { id: 'cand-2', employeeId: 'emp-2', rank: 2, feasible: true, consentState: 'NOT_ASKED' },
      ],
    })
    expect(isMineToConsent(p, 'emp-1')).toBe(false)
  })

  it('is false when activeCandidateId does not match any candidate row', () => {
    expect(isMineToConsent(proposal({ activeCandidateId: 'missing' }), 'emp-1')).toBe(false)
  })
})
