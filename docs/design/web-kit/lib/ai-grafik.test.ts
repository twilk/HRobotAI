import { describe, expect, it } from 'vitest'
import {
  autonomyLabel,
  validateQuietHours,
  AUTONOMY_LEVELS,
  aiProposalActions,
  proposalStateLabel,
  isMineToConsent,
  shiftLabelOf,
  travelBadgeText,
  costBreakdownText,
  costCellText,
  myTravelText,
  NO_CANDIDATE_MESSAGE,
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

describe('shiftLabelOf', () => {
  it('formats a known Monday as "pon dd.mm · start–end · ROLE"', () => {
    expect(
      shiftLabelOf({ id: 's-1', date: '2026-07-13', start: '06:00', end: '14:00', role: 'RECEPCJA' }),
    ).toBe('pon 13.07 · 06:00–14:00 · RECEPCJA')
  })

  it('formats a known Sunday as "nd dd.mm · start–end · ROLE"', () => {
    expect(
      shiftLabelOf({ id: 's-2', date: '2026-07-19', start: '22:00', end: '06:00', role: 'OCHRONA' }),
    ).toBe('nd 19.07 · 22:00–06:00 · OCHRONA')
  })

  it('tolerates a full ISO datetime, using only the date portion', () => {
    expect(
      shiftLabelOf({
        id: 's-3',
        date: '2026-07-13T00:00:00.000Z',
        start: '06:00',
        end: '14:00',
        role: 'RECEPCJA',
      }),
    ).toBe('pon 13.07 · 06:00–14:00 · RECEPCJA')
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

// --- cross-unit travel display (2026-07-14 spec §12 Etap 3) -----------------------------------------
// Pure formatters over already-ROUNDED server figures — no network, no coordinates (RODO).

describe('travelBadgeText', () => {
  it('renders "cross-unit · ~N km · ~M min · +X zł" for a non-zero travel candidate', () => {
    expect(travelBadgeText({ travelKm: 7, travelMinutes: 7, travelCost: 16.1 })).toBe(
      'cross-unit · ~7 km · ~7 min · +16,10 zł',
    )
  })

  it('tolerates Decimal-as-string fields (Prisma over-JSON serialization)', () => {
    expect(travelBadgeText({ travelKm: '287', travelMinutes: '287', travelCost: '660.10' })).toBe(
      'cross-unit · ~287 km · ~287 min · +660,10 zł',
    )
  })

  it('returns null for a local candidate (travelKm 0, absent, or null)', () => {
    expect(travelBadgeText({ travelKm: 0, travelMinutes: 0, travelCost: 0 })).toBeNull()
    expect(travelBadgeText({})).toBeNull()
    expect(travelBadgeText({ travelKm: null, travelMinutes: null, travelCost: null })).toBeNull()
  })

  it('treats a non-finite/garbage travelKm as no badge rather than throwing', () => {
    expect(travelBadgeText({ travelKm: 'not-a-number' as unknown as string })).toBeNull()
  })
})

describe('costBreakdownText', () => {
  it('renders "praca X + dojazd Y = razem Z" when travel cost is non-zero', () => {
    expect(costBreakdownText(25.6, 16.1)).toBe('praca +9,50 zł + dojazd 16,10 zł = razem +25,60 zł')
  })

  it('renders the plain total (no breakdown) when travel cost is zero/absent (local candidate)', () => {
    expect(costBreakdownText(12, 0)).toBe('+12,00 zł')
    expect(costBreakdownText(12, null)).toBe('+12,00 zł')
    expect(costBreakdownText(12, undefined)).toBe('+12,00 zł')
  })

  it('falls back to "brak stawki" when the total itself is null', () => {
    expect(costBreakdownText(null, 16.1)).toBe('brak stawki')
  })

  it('handles a negative labour delta inside the breakdown (a cheaper candidate)', () => {
    // total 10 = labour(-6.1) + travel(16.1)
    expect(costBreakdownText(10, 16.1)).toBe('praca -6,10 zł + dojazd 16,10 zł = razem +10,00 zł')
  })
})

describe('costCellText', () => {
  it('shows "brak kandydata" (never "brak stawki") when there is no active candidate at all', () => {
    expect(costCellText(false, null, null)).toBe('brak kandydata')
    expect(costCellText(false, 25.6, 16.1)).toBe('brak kandydata')
  })

  it('delegates to costBreakdownText once a candidate exists', () => {
    expect(costCellText(true, 25.6, 16.1)).toBe(costBreakdownText(25.6, 16.1))
    expect(costCellText(true, null, null)).toBe('brak stawki')
  })
})

describe('myTravelText', () => {
  it('renders the candidate consent screen travel line for a non-zero travel candidate', () => {
    expect(myTravelText({ travelKm: 7, travelMinutes: 7 })).toBe(
      'Twój szacunkowy dojazd (demo): ~7 km · ~7 min',
    )
  })

  it('returns null for a local candidate', () => {
    expect(myTravelText({ travelKm: 0, travelMinutes: 0 })).toBeNull()
    expect(myTravelText({})).toBeNull()
  })
})

describe('NO_CANDIDATE_MESSAGE', () => {
  it('is a non-empty operator instruction distinct from the missing-rate copy', () => {
    expect(NO_CANDIDATE_MESSAGE).toBe('Brak dostępnego zastępcy — obsłuż ręcznie w Grafiku')
  })
})
