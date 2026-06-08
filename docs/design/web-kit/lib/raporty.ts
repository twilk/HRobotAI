// HR Analytics (Raporty) — computed statistics derived from other data stores.
// Pure computations; no mutations, no I/O side-effects.

import { getEmployees } from '@/lib/employees'
import { getLeaveRequests } from '@/lib/wnioski'
import { SEED_SHIFTS, shiftHours, startOfWeek, addDays, ymd, type Shift } from '@/lib/schedule'
import { getFacilities } from '@/lib/facilities'
import { getAccessEntries } from '@/lib/dostepy'

export interface EmployeeStats {
  total: number
  active: number
  onLeave: number
}

export interface LeaveStats {
  pending: number
  approved: number
  rejected: number
  thisMonth: number
  byType: Record<string, number>
}

export interface ScheduleStats {
  totalShiftsThisWeek: number
  totalHoursThisWeek: number
  coverageByFacility: Array<{ facilityId: string; facilityName: string; shiftsCount: number }>
}

export interface AccessStats {
  employeesWithAdminAccess: number
  moduleAdoption: Array<{ module: string; activeCount: number }>
}

export interface HRSummary {
  employees: EmployeeStats
  leave: LeaveStats
  schedule: ScheduleStats
  access: AccessStats
  generatedAt: string
}

export function getEmployeeStats(): EmployeeStats {
  const employees = getEmployees()
  const total = employees.length
  const active = employees.filter((e) => e.status === 'active').length
  const onLeave = employees.filter((e) => e.status === 'leave').length
  return { total, active, onLeave }
}

export function getLeaveStats(): LeaveStats {
  const all = getLeaveRequests()
  const pending = all.filter((r) => r.status === 'pending').length
  const approved = all.filter((r) => r.status === 'approved').length
  const rejected = all.filter((r) => r.status === 'rejected').length

  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = all.filter((r) => {
    const d = new Date(r.requestedAt)
    return d.getFullYear() === thisYear && d.getMonth() === now.getMonth()
  }).length

  const byType: Record<string, number> = {}
  for (const r of all) {
    byType[r.type] = (byType[r.type] ?? 0) + 1
  }

  return { pending, approved, rejected, thisMonth, byType }
}

export function getScheduleStats(): ScheduleStats {
  const facilities = getFacilities()
  const today = new Date()
  const weekStart = startOfWeek(today)

  // Materialize SEED_SHIFTS for this week across all facilities
  const shifts: Shift[] = SEED_SHIFTS.map((seed, i) => ({
    id: `raporty-s-${i}`,
    employeeId: seed.employeeId,
    facilityId: seed.facilityId,
    date: ymd(addDays(weekStart, seed.dayIndex)),
    start: seed.start,
    end: seed.end,
  }))

  const totalShiftsThisWeek = shifts.length
  const totalHoursThisWeek = shifts.reduce((sum, s) => sum + shiftHours(s), 0)

  const coverageByFacility = facilities.map((f) => {
    const facilityShifts = shifts.filter((s) => s.facilityId === f.id)
    return {
      facilityId: f.id,
      facilityName: f.name,
      shiftsCount: facilityShifts.length,
    }
  })

  return { totalShiftsThisWeek, totalHoursThisWeek, coverageByFacility }
}

export function getAccessStats(): AccessStats {
  const entries = getAccessEntries()

  // Employees who have 'admin' level on ANY module
  const adminEmployeeIds = new Set(
    entries.filter((e) => e.level === 'admin').map((e) => e.employeeId),
  )
  const employeesWithAdminAccess = adminEmployeeIds.size

  // Unique modules present in entries
  const modules = [...new Set(entries.map((e) => e.module))]

  const moduleAdoption = modules.map((module) => {
    const activeCount = new Set(
      entries
        .filter((e) => e.module === module && (e.level === 'edycja' || e.level === 'admin'))
        .map((e) => e.employeeId),
    ).size
    return { module, activeCount }
  })

  return { employeesWithAdminAccess, moduleAdoption }
}

export function getHRSummary(): HRSummary {
  return {
    employees: getEmployeeStats(),
    leave: getLeaveStats(),
    schedule: getScheduleStats(),
    access: getAccessStats(),
    generatedAt: new Date().toISOString(),
  }
}
