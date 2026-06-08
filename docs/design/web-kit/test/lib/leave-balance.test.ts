import { describe, it, expect, beforeEach } from 'vitest'
import {
  getLeaveBalance,
  getAllLeaveBalances,
  deductLeave,
  resetLeaveBalances,
  type LeaveBalance,
} from '@/lib/leave-balance'

describe('getAllLeaveBalances', () => {
  beforeEach(() => resetLeaveBalances())

  it('returns all 4 seed records for current year', () => {
    const balances = getAllLeaveBalances()
    expect(balances).toHaveLength(4)
  })

  it('each record has required fields', () => {
    const balances = getAllLeaveBalances()
    for (const b of balances) {
      expect(b.id).toBeTruthy()
      expect(b.employeeId).toBeTruthy()
      expect(b.employeeName).toBeTruthy()
      expect(b.year).toBeGreaterThan(2020)
      expect(b.urlop_wypoczynkowy).toBeDefined()
      expect(b.urlop_ojcowski).toBeDefined()
      expect(b.inne).toBeDefined()
    }
  })

  it('filters by year when provided', () => {
    const balances2026 = getAllLeaveBalances(2026)
    expect(balances2026.every((b) => b.year === 2026)).toBe(true)
    expect(balances2026.length).toBe(4)
  })

  it('returns empty array for year with no data', () => {
    const balances = getAllLeaveBalances(1999)
    expect(balances).toHaveLength(0)
  })
})

describe('getLeaveBalance', () => {
  beforeEach(() => resetLeaveBalances())

  it('returns correct record for known employee', () => {
    const balance = getLeaveBalance('1')
    expect(balance).toBeDefined()
    expect(balance?.employeeId).toBe('1')
    expect(balance?.employeeName).toBe('Anna Nowak')
  })

  it('returns undefined for unknown employee', () => {
    expect(getLeaveBalance('999')).toBeUndefined()
  })

  it('defaults to current year', () => {
    const balance = getLeaveBalance('1')
    expect(balance?.year).toBe(new Date().getFullYear())
  })

  it('accepts explicit year parameter', () => {
    const balance = getLeaveBalance('1', 2026)
    expect(balance?.year).toBe(2026)
  })

  it('urlop_wypoczynkowy entitled is 26', () => {
    const balance = getLeaveBalance('1')
    expect(balance?.urlop_wypoczynkowy.entitled).toBe(26)
  })

  it('urlop_ojcowski entitled is 14', () => {
    const balance = getLeaveBalance('1')
    expect(balance?.urlop_ojcowski.entitled).toBe(14)
  })

  it('inne entitled is 10', () => {
    const balance = getLeaveBalance('1')
    expect(balance?.inne.entitled).toBe(10)
  })
})

describe('deductLeave', () => {
  beforeEach(() => resetLeaveBalances())

  it('reduces remaining for urlop-wypoczynkowy', () => {
    const before = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining
    const result = deductLeave('1', 'urlop-wypoczynkowy', 5)
    expect(result).toBe(true)
    const after = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining
    expect(after).toBe(before - 5)
  })

  it('reduces remaining for urlop-ojcowski', () => {
    const before = getLeaveBalance('1')!.urlop_ojcowski.remaining
    const result = deductLeave('1', 'urlop-ojcowski', 2)
    expect(result).toBe(true)
    const after = getLeaveBalance('1')!.urlop_ojcowski.remaining
    expect(after).toBe(before - 2)
  })

  it('reduces remaining for inne', () => {
    const before = getLeaveBalance('2')!.inne.remaining
    const result = deductLeave('2', 'inne', 1)
    expect(result).toBe(true)
    const after = getLeaveBalance('2')!.inne.remaining
    expect(after).toBe(before - 1)
  })

  it('returns false when balance is insufficient', () => {
    const result = deductLeave('1', 'urlop-wypoczynkowy', 999)
    expect(result).toBe(false)
  })

  it('does not reduce balance when insufficient', () => {
    const before = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining
    deductLeave('1', 'urlop-wypoczynkowy', 999)
    const after = getLeaveBalance('1')!.urlop_wypoczynkowy.remaining
    expect(after).toBe(before)
  })

  it('does not reduce below zero', () => {
    // Keep deducting until just at zero then verify one more fails
    const balance = getLeaveBalance('3')!
    const remaining = balance.inne.remaining
    if (remaining > 0) {
      deductLeave('3', 'inne', remaining) // drain to zero
    }
    const result = deductLeave('3', 'inne', 1)
    expect(result).toBe(false)
    expect(getLeaveBalance('3')!.inne.remaining).toBe(0)
  })

  it('returns false for unknown employee', () => {
    const result = deductLeave('999', 'urlop-wypoczynkowy', 1)
    expect(result).toBe(false)
  })

  it('increments used when deducting', () => {
    const before = getLeaveBalance('2')!.urlop_wypoczynkowy.used
    deductLeave('2', 'urlop-wypoczynkowy', 3)
    const after = getLeaveBalance('2')!.urlop_wypoczynkowy.used
    expect(after).toBe(before + 3)
  })
})

describe('remaining = entitled - used invariant', () => {
  beforeEach(() => resetLeaveBalances())

  it('remaining equals entitled - used for all seed records', () => {
    const balances = getAllLeaveBalances()
    for (const b of balances) {
      expect(b.urlop_wypoczynkowy.remaining).toBe(
        b.urlop_wypoczynkowy.entitled - b.urlop_wypoczynkowy.used,
      )
      expect(b.urlop_ojcowski.remaining).toBe(
        b.urlop_ojcowski.entitled - b.urlop_ojcowski.used,
      )
      expect(b.inne.remaining).toBe(b.inne.entitled - b.inne.used)
    }
  })

  it('remaining = entitled - used holds after deduction', () => {
    deductLeave('1', 'urlop-wypoczynkowy', 3)
    const b = getLeaveBalance('1')!
    expect(b.urlop_wypoczynkowy.remaining).toBe(
      b.urlop_wypoczynkowy.entitled - b.urlop_wypoczynkowy.used,
    )
  })
})
