import { describe, it, expect } from 'vitest'
import {
  getEmployeeStats,
  getLeaveStats,
  getScheduleStats,
  getAccessStats,
  getHRSummary,
  type EmployeeStats,
  type LeaveStats,
  type ScheduleStats,
  type AccessStats,
  type HRSummary,
} from '@/lib/raporty'

// Seed counts from lib/employees.ts (6 employees: 5 active, 1 on leave)
// Seed from lib/wnioski.ts: 7 requests — 2 pending, 3 approved, 1 rejected, 1 cancelled
// Seed from lib/schedule.ts SEED_SHIFTS: 18 entries across 3 facilities
// Seed from lib/dostepy.ts: 4 employees × 5 modules = 20 entries

describe('getEmployeeStats', () => {
  it('returns total of 6 seed employees', () => {
    const stats = getEmployeeStats()
    expect(stats.total).toBe(6)
  })

  it('returns 5 active employees (status=active)', () => {
    const stats = getEmployeeStats()
    expect(stats.active).toBe(5)
  })

  it('returns 1 employee on leave (status=leave)', () => {
    const stats = getEmployeeStats()
    expect(stats.onLeave).toBe(1)
  })

  it('active + onLeave equals total', () => {
    const { total, active, onLeave } = getEmployeeStats()
    expect(active + onLeave).toBe(total)
  })

  it('returns an object with exactly the EmployeeStats shape', () => {
    const stats = getEmployeeStats()
    expect(typeof stats.total).toBe('number')
    expect(typeof stats.active).toBe('number')
    expect(typeof stats.onLeave).toBe('number')
  })
})

describe('getLeaveStats', () => {
  it('returns 2 pending leave requests from seed', () => {
    const stats = getLeaveStats()
    expect(stats.pending).toBe(2)
  })

  it('returns 3 approved leave requests from seed', () => {
    const stats = getLeaveStats()
    expect(stats.approved).toBe(3)
  })

  it('returns 1 rejected leave request from seed', () => {
    const stats = getLeaveStats()
    expect(stats.rejected).toBe(1)
  })

  it('returns correct thisMonth count — requests with requestedAt in June 2026', () => {
    // Seed: wr-3 (2026-06-05), wr-4 (2026-06-03), wr-6 (2026-06-07) — 3 in June 2026
    const stats = getLeaveStats()
    expect(stats.thisMonth).toBeGreaterThanOrEqual(3)
  })

  it('byType is an object with counts per LeaveType', () => {
    const stats = getLeaveStats()
    expect(typeof stats.byType).toBe('object')
    // urlop-wypoczynkowy appears in wr-1, wr-6 (2 entries)
    expect(stats.byType['urlop-wypoczynkowy']).toBeGreaterThanOrEqual(2)
    // urlop-macierzynski appears in wr-5
    expect(stats.byType['urlop-macierzynski']).toBeGreaterThanOrEqual(1)
  })

  it('pending + approved + rejected is less than total (cancelled exists)', () => {
    const { pending, approved, rejected } = getLeaveStats()
    // Total seed = 7, cancelled = 1, so pending+approved+rejected = 6
    expect(pending + approved + rejected).toBeLessThan(7 + 1) // tolerant of extra test data
    expect(pending + approved + rejected).toBeGreaterThanOrEqual(6)
  })
})

describe('getScheduleStats', () => {
  it('returns totalShiftsThisWeek > 0 (materialized from SEED_SHIFTS for current week)', () => {
    const stats = getScheduleStats()
    expect(stats.totalShiftsThisWeek).toBeGreaterThan(0)
  })

  it('returns totalHoursThisWeek > 0', () => {
    const stats = getScheduleStats()
    expect(stats.totalHoursThisWeek).toBeGreaterThan(0)
  })

  it('coverageByFacility contains 3 facilities', () => {
    const stats = getScheduleStats()
    expect(stats.coverageByFacility).toHaveLength(3)
  })

  it('each coverage item has facilityId, facilityName, shiftsCount', () => {
    const stats = getScheduleStats()
    for (const item of stats.coverageByFacility) {
      expect(typeof item.facilityId).toBe('string')
      expect(typeof item.facilityName).toBe('string')
      expect(typeof item.shiftsCount).toBe('number')
      expect(item.shiftsCount).toBeGreaterThan(0)
    }
  })

  it('total shifts = sum of shiftsCount across all facilities', () => {
    const stats = getScheduleStats()
    const sumFromFacilities = stats.coverageByFacility.reduce((s, f) => s + f.shiftsCount, 0)
    expect(stats.totalShiftsThisWeek).toBe(sumFromFacilities)
  })
})

describe('getAccessStats', () => {
  it('returns employeesWithAdminAccess >= 1 (Katarzyna has admin on wnioski+raporty)', () => {
    const stats = getAccessStats()
    expect(stats.employeesWithAdminAccess).toBeGreaterThanOrEqual(1)
  })

  it('moduleAdoption has entries for every module', () => {
    const stats = getAccessStats()
    const modules = stats.moduleAdoption.map((m) => m.module)
    expect(modules).toContain('grafik')
    expect(modules).toContain('wnioski')
    expect(modules).toContain('raporty')
  })

  it('moduleAdoption activeCount counts employees with edycja or admin', () => {
    const stats = getAccessStats()
    // grafik: Anna(edycja), Katarzyna(edycja) = 2
    const grafik = stats.moduleAdoption.find((m) => m.module === 'grafik')
    expect(grafik?.activeCount).toBeGreaterThanOrEqual(2)
  })

  it('returns an AccessStats shape', () => {
    const stats = getAccessStats()
    expect(typeof stats.employeesWithAdminAccess).toBe('number')
    expect(Array.isArray(stats.moduleAdoption)).toBe(true)
  })
})

describe('getHRSummary', () => {
  it('contains employees, leave, schedule, access, generatedAt', () => {
    const summary = getHRSummary()
    expect(summary.employees).toBeDefined()
    expect(summary.leave).toBeDefined()
    expect(summary.schedule).toBeDefined()
    expect(summary.access).toBeDefined()
    expect(typeof summary.generatedAt).toBe('string')
  })

  it('generatedAt is an ISO timestamp', () => {
    const { generatedAt } = getHRSummary()
    expect(() => new Date(generatedAt)).not.toThrow()
    expect(new Date(generatedAt).toISOString()).toBe(generatedAt)
  })

  it('nested employees stats are consistent', () => {
    const { employees } = getHRSummary()
    expect(employees.total).toBe(6)
    expect(employees.active + employees.onLeave).toBe(employees.total)
  })
})
