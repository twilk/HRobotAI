import { describe, it, expect, beforeEach } from 'vitest'
import {
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
} from '@/lib/actions/wnioski-actions'
import { getLeaveRequests, getLeaveRequest } from '@/lib/wnioski'

// Note: the wnioski store is module-level mutable state.
// Tests here add new entries with unique identifiers and do not reset the store,
// so earlier tests don't affect assertions on ids returned within each test.

describe('createLeaveRequest', () => {
  it('persists a new request to the store and returns success + id', async () => {
    const before = getLeaveRequests().length
    const result = await createLeaveRequest({
      employeeId: 'test-emp-1',
      employeeName: 'Test Pracownik',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-05',
      days: 5,
    })
    expect(result.success).toBe(true)
    expect(result.id).toBeTruthy()
    expect(getLeaveRequests().length).toBe(before + 1)
  })

  it('new request is retrievable by returned id', async () => {
    const result = await createLeaveRequest({
      employeeId: 'test-emp-2',
      employeeName: 'Test Pracownik B',
      type: 'urlop-chorobowy',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-03',
      days: 3,
    })
    expect(result.success).toBe(true)
    const stored = getLeaveRequest(result.id!)
    expect(stored).toBeDefined()
    expect(stored?.employeeId).toBe('test-emp-2')
    expect(stored?.status).toBe('pending')
  })

  it('accepts optional reason field', async () => {
    const result = await createLeaveRequest({
      employeeId: 'test-emp-3',
      employeeName: 'Test Pracownik C',
      type: 'inne',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-01',
      days: 1,
      reason: 'Powód testowy',
    })
    expect(result.success).toBe(true)
    const stored = getLeaveRequest(result.id!)
    expect(stored?.reason).toBe('Powód testowy')
  })

  it('returns error when type is missing', async () => {
    const result = await createLeaveRequest({
      employeeId: 'test-emp-4',
      employeeName: 'Test Pracownik D',
      type: '' as any,
      dateFrom: '2026-11-01',
      dateTo: '2026-11-01',
      days: 1,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns error when employeeId is missing', async () => {
    const result = await createLeaveRequest({
      employeeId: '',
      employeeName: 'Test Pracownik E',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-01',
      days: 1,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns error when days is zero or negative', async () => {
    const result = await createLeaveRequest({
      employeeId: 'test-emp-6',
      employeeName: 'Test Pracownik F',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-01',
      days: 0,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('approveLeaveRequest', () => {
  it('sets status to approved', async () => {
    const created = await createLeaveRequest({
      employeeId: 'test-emp-approve-1',
      employeeName: 'Approve Test',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-05',
      days: 5,
    })
    expect(created.success).toBe(true)
    const result = await approveLeaveRequest(created.id!, 'manager@hrobot.ai')
    expect(result.success).toBe(true)
    const stored = getLeaveRequest(created.id!)
    expect(stored?.status).toBe('approved')
    expect(stored?.approvedBy).toBe('manager@hrobot.ai')
    expect(stored?.approvedAt).toBeTruthy()
  })

  it('returns error for unknown id', async () => {
    const result = await approveLeaveRequest('nonexistent-id-xyz', 'manager@hrobot.ai')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('rejectLeaveRequest', () => {
  it('sets status to rejected with rejectionReason', async () => {
    const created = await createLeaveRequest({
      employeeId: 'test-emp-reject-1',
      employeeName: 'Reject Test',
      type: 'inne',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-01',
      days: 1,
    })
    expect(created.success).toBe(true)
    const result = await rejectLeaveRequest(created.id!, 'manager@hrobot.ai', 'Za mała obsada')
    expect(result.success).toBe(true)
    const stored = getLeaveRequest(created.id!)
    expect(stored?.status).toBe('rejected')
    expect(stored?.rejectionReason).toBe('Za mała obsada')
  })

  it('returns error for unknown id', async () => {
    const result = await rejectLeaveRequest('nonexistent-id-xyz', 'manager@hrobot.ai', 'reason')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('cancelLeaveRequest', () => {
  it('sets status to cancelled', async () => {
    const created = await createLeaveRequest({
      employeeId: 'test-emp-cancel-1',
      employeeName: 'Cancel Test',
      type: 'urlop-ojcowski',
      dateFrom: '2026-12-01',
      dateTo: '2026-12-02',
      days: 2,
    })
    expect(created.success).toBe(true)
    const result = await cancelLeaveRequest(created.id!)
    expect(result.success).toBe(true)
    const stored = getLeaveRequest(created.id!)
    expect(stored?.status).toBe('cancelled')
  })

  it('returns error for unknown id', async () => {
    const result = await cancelLeaveRequest('nonexistent-id-xyz')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
