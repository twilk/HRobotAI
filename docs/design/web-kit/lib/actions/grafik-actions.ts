'use server'
import { addShift, removeShift, updateShift, type Shift } from '@/lib/schedule'

interface CreateShiftData {
  facilityId: string
  employeeId: string
  employeeName: string
  weekStart: string   // YYYY-MM-DD Monday
  dayIndex: number    // 0=Mon … 6=Sun
  startTime: string   // 'HH:MM'
  endTime: string     // 'HH:MM'
  role?: string
}

/** Compute YYYY-MM-DD for (weekStart + dayIndex) without timezone drift. */
function dateFromWeekStart(weekStart: string, dayIndex: number): string {
  const [year, month, day] = weekStart.split('-').map(Number)
  const d = new Date(year, month - 1, day + dayIndex)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function createShift(
  data: CreateShiftData,
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!data.facilityId) {
    return { success: false, error: 'facilityId is required' }
  }
  if (!data.employeeId) {
    return { success: false, error: 'employeeId is required' }
  }
  if (!data.weekStart) {
    return { success: false, error: 'weekStart is required' }
  }
  if (!data.startTime) {
    return { success: false, error: 'startTime is required' }
  }
  if (!data.endTime) {
    return { success: false, error: 'endTime is required' }
  }

  const date = dateFromWeekStart(data.weekStart, data.dayIndex)

  const shift = addShift({
    facilityId: data.facilityId,
    employeeId: data.employeeId,
    date,
    start: data.startTime,
    end: data.endTime,
    ...(data.role !== undefined ? { role: data.role } : {}),
  })

  return { success: true, id: shift.id }
}

export async function deleteShift(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const removed = removeShift(id)
  if (!removed) {
    return { success: false, error: `Shift '${id}' not found` }
  }
  return { success: true }
}

export async function patchShift(
  id: string,
  updates: Partial<Omit<Shift, 'id'>>,
): Promise<{ success: boolean; error?: string }> {
  const updated = updateShift(id, updates)
  if (!updated) {
    return { success: false, error: `Shift '${id}' not found` }
  }
  return { success: true }
}
