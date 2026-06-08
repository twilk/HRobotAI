// Mock leave-balance data for the reference app.
//
// In the real app this comes from the authenticated tenant runtime.
// Tracks yearly leave entitlements per employee.

export interface LeaveBalance {
  id: string
  employeeId: string
  employeeName: string
  year: number
  urlop_wypoczynkowy: { entitled: number; used: number; remaining: number }
  urlop_ojcowski: { entitled: number; used: number; remaining: number }
  inne: { entitled: number; used: number; remaining: number }
}

type TrackableLeaveType = 'urlop-wypoczynkowy' | 'urlop-ojcowski' | 'inne'

function makeBalances(year: number): LeaveBalance[] {
  return [
    {
      id: `lb-1-${year}`,
      employeeId: '1',
      employeeName: 'Anna Nowak',
      year,
      urlop_wypoczynkowy: { entitled: 26, used: 10, remaining: 16 },
      urlop_ojcowski: { entitled: 14, used: 0, remaining: 14 },
      inne: { entitled: 10, used: 3, remaining: 7 },
    },
    {
      id: `lb-2-${year}`,
      employeeId: '2',
      employeeName: 'Piotr Wiśniewski',
      year,
      urlop_wypoczynkowy: { entitled: 26, used: 4, remaining: 22 },
      urlop_ojcowski: { entitled: 14, used: 14, remaining: 0 },
      inne: { entitled: 10, used: 0, remaining: 10 },
    },
    {
      id: `lb-3-${year}`,
      employeeId: '3',
      employeeName: 'Katarzyna Wójcik',
      year,
      urlop_wypoczynkowy: { entitled: 26, used: 5, remaining: 21 },
      urlop_ojcowski: { entitled: 14, used: 0, remaining: 14 },
      inne: { entitled: 10, used: 2, remaining: 8 },
    },
    {
      id: `lb-4-${year}`,
      employeeId: '4',
      employeeName: 'Tomasz Kamiński',
      year,
      urlop_wypoczynkowy: { entitled: 26, used: 24, remaining: 2 },
      urlop_ojcowski: { entitled: 14, used: 0, remaining: 14 },
      inne: { entitled: 10, used: 8, remaining: 2 },
    },
  ]
}

// Mutable in-memory store — keyed by year for multi-year support
let STORE: Map<number, LeaveBalance[]> = new Map()

function ensureYear(year: number): LeaveBalance[] {
  if (!STORE.has(year)) {
    STORE.set(year, makeBalances(year))
  }
  return STORE.get(year)!
}

/** Reset to initial seed data (for test isolation). */
export function resetLeaveBalances(): void {
  STORE = new Map()
}

/** Returns all balances for a given year (defaults to current year). */
export function getAllLeaveBalances(year?: number): LeaveBalance[] {
  const y = year ?? new Date().getFullYear()
  // If a specific year is requested and we have no data, return empty (don't seed)
  if (year !== undefined && !STORE.has(year) && year !== new Date().getFullYear()) {
    // Only seed the current year by default; other years return empty unless explicitly seeded
    return []
  }
  return ensureYear(y)
}

/** Returns the balance for a specific employee+year (defaults to current year). */
export function getLeaveBalance(
  employeeId: string,
  year?: number,
): LeaveBalance | undefined {
  const balances = getAllLeaveBalances(year)
  return balances.find((b) => b.employeeId === employeeId)
}

/**
 * Adds an initial leave balance record for a new employee.
 * Uses default entitlements: 26 days annual, 14 days paternity, 10 days other.
 * Returns the created LeaveBalance.
 */
export function addLeaveBalance(
  employeeId: string,
  employeeName: string,
  year?: number,
): LeaveBalance {
  const y = year ?? new Date().getFullYear()
  const balances = ensureYear(y)
  const existing = balances.find((b) => b.employeeId === employeeId)
  if (existing) return existing

  const entry: LeaveBalance = {
    id: `lb-${employeeId}-${y}`,
    employeeId,
    employeeName,
    year: y,
    urlop_wypoczynkowy: { entitled: 26, used: 0, remaining: 26 },
    urlop_ojcowski: { entitled: 14, used: 0, remaining: 14 },
    inne: { entitled: 10, used: 0, remaining: 10 },
  }
  balances.push(entry)
  return entry
}

/**
 * Deducts `days` from the employee's leave balance for a given type.
 * Returns true on success, false if insufficient balance or employee not found.
 */
export function deductLeave(
  employeeId: string,
  leaveType: TrackableLeaveType,
  days: number,
  year?: number,
): boolean {
  const y = year ?? new Date().getFullYear()
  const balances = ensureYear(y)
  const idx = balances.findIndex((b) => b.employeeId === employeeId)
  if (idx === -1) return false

  const balance = balances[idx]

  const fieldKey =
    leaveType === 'urlop-wypoczynkowy'
      ? 'urlop_wypoczynkowy'
      : leaveType === 'urlop-ojcowski'
        ? 'urlop_ojcowski'
        : 'inne'

  const slot = balance[fieldKey]
  if (slot.remaining < days) return false

  balances[idx] = {
    ...balance,
    [fieldKey]: {
      ...slot,
      used: slot.used + days,
      remaining: slot.remaining - days,
    },
  }

  return true
}
