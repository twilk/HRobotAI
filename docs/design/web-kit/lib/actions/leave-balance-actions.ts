'use server'
import { getLeaveBalance, deductLeave, type LeaveBalance } from '@/lib/leave-balance'

type TrackableLeaveType = 'urlop-wypoczynkowy' | 'urlop-ojcowski' | 'inne'

const TRACKABLE_TYPES: string[] = ['urlop-wypoczynkowy', 'urlop-ojcowski', 'inne']

/** Returns the leave balance for a given employee, or null if not found. */
export async function getEmployeeBalance(employeeId: string): Promise<LeaveBalance | null> {
  return getLeaveBalance(employeeId) ?? null
}

/**
 * Deducts `days` from the employee's leave balance for a given type.
 * Returns { success: true } or { success: false, error: string }.
 */
export async function deductEmployeeLeave(
  employeeId: string,
  leaveType: string,
  days: number,
): Promise<{ success: boolean; error?: string }> {
  if (!TRACKABLE_TYPES.includes(leaveType)) {
    return { success: false, error: `Leave type '${leaveType}' is not tracked in balance` }
  }

  const exists = getLeaveBalance(employeeId)
  if (!exists) {
    return { success: false, error: `No balance found for employee '${employeeId}'` }
  }

  const ok = deductLeave(employeeId, leaveType as TrackableLeaveType, days)
  if (!ok) {
    return { success: false, error: 'Insufficient leave balance' }
  }

  return { success: true }
}
