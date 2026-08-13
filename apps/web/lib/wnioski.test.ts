import { describe, expect, it } from 'vitest'
import {
  leaveStatusLabel,
  leaveTypeLabel,
  validateLeaveRange,
  leaveActions,
  enrichLeave,
  enrichLeavesWith,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  type LeaveRow,
  type LeaveStatus,
} from './wnioski'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node', so these cover only the pure
// helpers the Wnioski screen relies on: the Polish status/type labels, the create-form range
// validator, the state->action gate, and the id->name enrichment projection. No network, no PII.

describe('leaveStatusLabel', () => {
  it('maps every lifecycle status to a distinct Polish label', () => {
    const labels = LEAVE_STATUSES.map(leaveStatusLabel)
    expect(LEAVE_STATUSES).toHaveLength(4)
    expect(new Set(labels).size).toBe(4)
  })

  it('echoes an unknown value back rather than throwing', () => {
    expect(leaveStatusLabel('SOMETHING_UNKNOWN' as LeaveStatus)).toBe('SOMETHING_UNKNOWN')
  })
})

describe('leaveTypeLabel', () => {
  it('maps every curated leave type to a distinct Polish label', () => {
    const labels = LEAVE_TYPES.map(leaveTypeLabel)
    expect(new Set(labels).size).toBe(LEAVE_TYPES.length)
  })

  it('falls back to the raw value for a free-form/unknown type (backend has no enum)', () => {
    expect(leaveTypeLabel('SOME_CUSTOM_TYPE')).toBe('SOME_CUSTOM_TYPE')
  })
})

describe('validateLeaveRange', () => {
  it('accepts endDate === startDate (single-day leave)', () => {
    expect(validateLeaveRange('2026-08-01', '2026-08-01')).toBe(true)
  })

  it('accepts a well-formed forward range', () => {
    expect(validateLeaveRange('2026-08-01', '2026-08-05')).toBe(true)
  })

  it('rejects an inverted range (endDate before startDate)', () => {
    expect(validateLeaveRange('2026-08-05', '2026-08-01')).toBe(false)
  })

  it('rejects an empty bound', () => {
    expect(validateLeaveRange('', '2026-08-05')).toBe(false)
    expect(validateLeaveRange('2026-08-01', '')).toBe(false)
    expect(validateLeaveRange('', '')).toBe(false)
  })
})

describe('leaveActions', () => {
  it('gives the owner cancel only while PENDING', () => {
    expect(leaveActions('PENDING', 'owner')).toEqual([{ action: 'cancel', label: 'Anuluj' }])
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED'] as LeaveStatus[]) {
      expect(leaveActions(status, 'owner')).toEqual([])
    }
  })

  it('gives a decider approve/reject only while PENDING', () => {
    expect(leaveActions('PENDING', 'decider')).toEqual([
      { action: 'approve', label: 'Zatwierdź' },
      { action: 'reject', label: 'Odrzuć' },
    ])
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED'] as LeaveStatus[]) {
      expect(leaveActions(status, 'decider')).toEqual([])
    }
  })

  it('offers nothing when the caller has no relationship to the request', () => {
    expect(leaveActions('PENDING', null)).toEqual([])
  })
})

describe('enrichLeave / enrichLeavesWith', () => {
  const row: LeaveRow = {
    id: 'leave-1',
    employeeId: 'emp-1',
    startDate: '2026-08-01',
    endDate: '2026-08-05',
    status: 'PENDING',
    type: 'URLOP_WYPOCZYNKOWY',
    decidedByUserId: null,
    decidedAt: null,
    reason: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }

  it('resolves a known employeeId to its name', () => {
    const map = new Map([['emp-1', 'Jan Kowalski']])
    expect(enrichLeave(row, map).employeeName).toBe('Jan Kowalski')
  })

  it('falls back to a truncated id when the employee is not in the map', () => {
    expect(enrichLeave(row, new Map()).employeeName).toBe('emp-1'.slice(0, 8))
  })

  it('projects many rows against one map', () => {
    const map = new Map([['emp-1', 'Jan Kowalski']])
    const enriched = enrichLeavesWith([row, { ...row, id: 'leave-2', employeeId: 'emp-2' }], map)
    expect(enriched.map((e) => e.employeeName)).toEqual(['Jan Kowalski', 'emp-2'.slice(0, 8)])
  })
})
