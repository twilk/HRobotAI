import { describe, it, expect, beforeEach } from 'vitest'
import {
  deductEmployeeLeave,
  getEmployeeBalance,
} from '@/lib/actions/leave-balance-actions'
import { resetLeaveBalances, getLeaveBalance } from '@/lib/leave-balance'

describe('getEmployeeBalance', () => {
  beforeEach(() => resetLeaveBalances())

  it('returns balance for known employee', async () => {
    const balance = await getEmployeeBalance('1')
    expect(balance).not.toBeNull()
    expect(balance?.employeeId).toBe('1')
    expect(balance?.employeeName).toBe('Anna Nowak')
  })

  it('returns null for unknown employee', async () => {
    const balance = await getEmployeeBalance('999')
    expect(balance).toBeNull()
  })

  it('returns correct urlop_wypoczynkowy entitled 26', async () => {
    const balance = await getEmployeeBalance('1')
    expect(balance?.urlop_wypoczynkowy.entitled).toBe(26)
  })
})

describe('deductEmployeeLeave', () => {
  beforeEach(() => resetLeaveBalances())

  it('returns success=true when balance is sufficient', async () => {
    const result = await deductEmployeeLeave('1', 'urlop-wypoczynkowy', 3)
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('deducts days from the balance', async () => {
    const before = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining
    await deductEmployeeLeave('1', 'urlop-wypoczynkowy', 3)
    const after = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining
    expect(after).toBe(before - 3)
  })

  it('returns success=false with error when insufficient balance', async () => {
    const result = await deductEmployeeLeave('1', 'urlop-wypoczynkowy', 9999)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns success=false when employee not found', async () => {
    const result = await deductEmployeeLeave('999', 'urlop-wypoczynkowy', 1)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('deducts urlop-ojcowski correctly', async () => {
    const before = getLeaveBalance('1')!.urlop_ojcowski.remaining
    const result = await deductEmployeeLeave('1', 'urlop-ojcowski', 2)
    expect(result.success).toBe(true)
    const after = getLeaveBalance('1')!.urlop_ojcowski.remaining
    expect(after).toBe(before - 2)
  })

  it('deducts inne correctly', async () => {
    const before = getLeaveBalance('2')!.inne.remaining
    const result = await deductEmployeeLeave('2', 'inne', 1)
    expect(result.success).toBe(true)
    const after = getLeaveBalance('2')!.inne.remaining
    expect(after).toBe(before - 1)
  })

  it('handles unsupported leaveType gracefully', async () => {
    // urlop-chorobowy is not trackable — should return false
    const result = await deductEmployeeLeave('1', 'urlop-chorobowy', 1)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('approveLeaveRequest auto-deduction integration', () => {
  beforeEach(() => resetLeaveBalances())

  it('approving a urlop-wypoczynkowy request deducts from balance', async () => {
    // Use the server action from wnioski-actions which wires into leave deduction
    const { approveLeaveRequest, createLeaveRequest } = await import('@/lib/actions/wnioski-actions')
    const created = await createLeaveRequest({
      employeeId: '1',
      employeeName: 'Anna Nowak',
      type: 'urlop-wypoczynkowy',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-05',
      days: 5,
    })
    expect(created.success).toBe(true)

    const before = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining

    const result = await approveLeaveRequest(created.id!, 'manager@hrobot.ai')
    expect(result.success).toBe(true)

    const after = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining
    expect(after).toBe(before - 5)
  })
})
