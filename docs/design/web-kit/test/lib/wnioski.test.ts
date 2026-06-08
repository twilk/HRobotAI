import { describe, it, expect, beforeEach } from 'vitest'
import {
  getLeaveRequests,
  getLeaveRequest,
  addLeaveRequest,
  updateLeaveRequest,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  type LeaveRequest,
  type LeaveType,
  type LeaveStatus,
} from '@/lib/wnioski'

// Reset module state between tests that mutate the store
// (vitest runs in same process, so we import fresh each suite but addLeaveRequest mutates a shared array)
// We isolate via beforeEach resetting via a helper or re-importing — for simplicity we tolerate order-dependent
// count checks and use unique employee IDs.

describe('LEAVE_TYPE_LABELS', () => {
  it('has Polish label for every leave type', () => {
    const types: LeaveType[] = ['urlop-wypoczynkowy', 'urlop-chorobowy', 'urlop-macierzynski', 'urlop-ojcowski', 'inne']
    for (const t of types) {
      expect(LEAVE_TYPE_LABELS[t]).toBeTruthy()
      expect(typeof LEAVE_TYPE_LABELS[t]).toBe('string')
    }
  })
})

describe('LEAVE_STATUS_LABELS', () => {
  it('has Polish label for every status', () => {
    const statuses: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled']
    for (const s of statuses) {
      expect(LEAVE_STATUS_LABELS[s]).toBeTruthy()
      expect(typeof LEAVE_STATUS_LABELS[s]).toBe('string')
    }
  })
})

describe('getLeaveRequests', () => {
  it('returns at least 6 seed requests', () => {
    const all = getLeaveRequests()
    expect(all.length).toBeGreaterThanOrEqual(6)
  })

  it('all requests have required fields', () => {
    for (const r of getLeaveRequests()) {
      expect(r.id).toBeTruthy()
      expect(r.employeeId).toBeTruthy()
      expect(r.employeeName).toBeTruthy()
      expect(r.type).toBeTruthy()
      expect(r.status).toBeTruthy()
      expect(r.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.days).toBeGreaterThan(0)
      expect(r.requestedAt).toBeTruthy()
    }
  })

  it('seed data covers multiple statuses', () => {
    const all = getLeaveRequests()
    const statuses = new Set(all.map((r) => r.status))
    expect(statuses.size).toBeGreaterThanOrEqual(2)
  })

  it('seed data covers multiple leave types', () => {
    const all = getLeaveRequests()
    const types = new Set(all.map((r) => r.type))
    expect(types.size).toBeGreaterThanOrEqual(2)
  })

  it('filters by status=pending', () => {
    const pending = getLeaveRequests({ status: 'pending' })
    expect(pending.every((r) => r.status === 'pending')).toBe(true)
  })

  it('filters by status=approved', () => {
    const approved = getLeaveRequests({ status: 'approved' })
    expect(approved.every((r) => r.status === 'approved')).toBe(true)
  })

  it('filters by employeeId', () => {
    const all = getLeaveRequests()
    const targetId = all[0].employeeId
    const filtered = getLeaveRequests({ employeeId: targetId })
    expect(filtered.every((r) => r.employeeId === targetId)).toBe(true)
    expect(filtered.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by both status and employeeId', () => {
    const all = getLeaveRequests()
    const { employeeId, status } = all[0]
    const filtered = getLeaveRequests({ status, employeeId })
    expect(filtered.every((r) => r.status === status && r.employeeId === employeeId)).toBe(true)
  })

  it('returns empty array when no filters match', () => {
    const result = getLeaveRequests({ employeeId: 'nonexistent-id-xyz' })
    expect(result).toHaveLength(0)
  })
})

describe('getLeaveRequest', () => {
  it('returns a request by id', () => {
    const all = getLeaveRequests()
    const first = all[0]
    const found = getLeaveRequest(first.id)
    expect(found).toBeDefined()
    expect(found?.id).toBe(first.id)
  })

  it('returns undefined for unknown id', () => {
    expect(getLeaveRequest('nonexistent-999')).toBeUndefined()
  })
})

describe('addLeaveRequest', () => {
  it('adds a new request and assigns id + status + requestedAt', () => {
    const before = getLeaveRequests().length
    const added = addLeaveRequest({
      employeeId: '1',
      employeeName: 'Anna Nowak',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-14',
      days: 10,
      reason: 'Wakacje',
    })
    expect(added.id).toBeTruthy()
    expect(added.status).toBe('pending')
    expect(added.requestedAt).toBeTruthy()
    expect(getLeaveRequests().length).toBe(before + 1)
  })

  it('added request is retrievable by id', () => {
    const added = addLeaveRequest({
      employeeId: '2',
      employeeName: 'Piotr Wiśniewski',
      type: 'inne',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-03',
      days: 3,
    })
    expect(getLeaveRequest(added.id)).toBeDefined()
    expect(getLeaveRequest(added.id)?.employeeId).toBe('2')
  })

  it('reason is optional', () => {
    const added = addLeaveRequest({
      employeeId: '3',
      employeeName: 'Katarzyna Wójcik',
      type: 'urlop-chorobowy',
      dateFrom: '2026-09-10',
      dateTo: '2026-09-12',
      days: 3,
    })
    expect(added.reason).toBeUndefined()
  })
})

describe('updateLeaveRequest', () => {
  it('approves a pending request', () => {
    const req = addLeaveRequest({
      employeeId: '4',
      employeeName: 'Tomasz Kamiński',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-05',
      days: 5,
    })
    const updated = updateLeaveRequest(req.id, {
      status: 'approved',
      approvedBy: 'Jan Kowalski',
      approvedAt: '2026-06-08T10:00:00.000Z',
    })
    expect(updated?.status).toBe('approved')
    expect(updated?.approvedBy).toBe('Jan Kowalski')
    expect(updated?.approvedAt).toBe('2026-06-08T10:00:00.000Z')
  })

  it('rejects a pending request with a reason', () => {
    const req = addLeaveRequest({
      employeeId: '5',
      employeeName: 'Magdalena Lewandowska',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-07',
      days: 5,
    })
    const updated = updateLeaveRequest(req.id, {
      status: 'rejected',
      rejectionReason: 'Zbyt duże obciążenie działu',
    })
    expect(updated?.status).toBe('rejected')
    expect(updated?.rejectionReason).toBe('Zbyt duże obciążenie działu')
  })

  it('returns undefined for unknown id', () => {
    const result = updateLeaveRequest('nonexistent-xyz', { status: 'approved' })
    expect(result).toBeUndefined()
  })

  it('persists update — getLeaveRequest reflects new status', () => {
    const req = addLeaveRequest({
      employeeId: '6',
      employeeName: 'Marek Zieliński',
      type: 'inne',
      dateFrom: '2026-12-01',
      dateTo: '2026-12-02',
      days: 2,
    })
    updateLeaveRequest(req.id, { status: 'cancelled' })
    expect(getLeaveRequest(req.id)?.status).toBe('cancelled')
  })
})
