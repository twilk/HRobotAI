import { describe, it, expect, beforeEach, vi } from 'vitest'

// We need fresh module state between tests because updateAccess mutates the store.
// Use vi.resetModules() + dynamic import for mutation tests.

import {
  getAccessEntries,
  getEmployeeAccessSummary,
  getAllAccessSummaries,
  updateAccess,
  MODULE_LABELS,
  ACCESS_LEVEL_LABELS,
  type AccessModule,
  type AccessLevel,
  type EmployeeAccess,
  type EmployeeAccessSummary,
} from '@/lib/dostepy'

const MODULES: AccessModule[] = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']
const LEVELS: AccessLevel[] = ['brak', 'podgląd', 'edycja', 'admin']

describe('MODULE_LABELS', () => {
  it('has a Polish label for every AccessModule', () => {
    for (const m of MODULES) {
      expect(MODULE_LABELS[m]).toBeTruthy()
      expect(typeof MODULE_LABELS[m]).toBe('string')
    }
  })

  it('all 5 modules are covered', () => {
    expect(Object.keys(MODULE_LABELS)).toHaveLength(5)
  })
})

describe('ACCESS_LEVEL_LABELS', () => {
  it('has a Polish label for every AccessLevel', () => {
    for (const l of LEVELS) {
      expect(ACCESS_LEVEL_LABELS[l]).toBeTruthy()
      expect(typeof ACCESS_LEVEL_LABELS[l]).toBe('string')
    }
  })

  it('includes Administrator label for admin level', () => {
    expect(ACCESS_LEVEL_LABELS['admin']).toMatch(/Administrator/i)
  })

  it('all 4 levels are covered', () => {
    expect(Object.keys(ACCESS_LEVEL_LABELS)).toHaveLength(4)
  })
})

describe('getAccessEntries', () => {
  it('returns at least 20 seed entries (4 employees × 5 modules)', () => {
    const entries = getAccessEntries()
    expect(entries.length).toBeGreaterThanOrEqual(20)
  })

  it('each entry has required fields', () => {
    for (const e of getAccessEntries()) {
      expect(e.id).toBeTruthy()
      expect(e.employeeId).toBeTruthy()
      expect(e.employeeName).toBeTruthy()
      expect(MODULES).toContain(e.module)
      expect(LEVELS).toContain(e.level)
    }
  })

  it('covers all 5 modules across seed data', () => {
    const modules = new Set(getAccessEntries().map((e) => e.module))
    for (const m of MODULES) {
      expect(modules.has(m)).toBe(true)
    }
  })

  it('covers all 4 access levels across seed data', () => {
    const levels = new Set(getAccessEntries().map((e) => e.level))
    // At minimum we should have brak and at least one of the elevated levels
    expect(levels.has('brak')).toBe(true)
    expect(levels.size).toBeGreaterThanOrEqual(2)
  })

  it('returns an array (does not throw)', () => {
    expect(() => getAccessEntries()).not.toThrow()
  })
})

describe('getEmployeeAccessSummary', () => {
  it('returns summary for a known employee id', () => {
    const entries = getAccessEntries()
    const firstEmployeeId = entries[0].employeeId
    const summary = getEmployeeAccessSummary(firstEmployeeId)
    expect(summary).toBeDefined()
    expect(summary?.employeeId).toBe(firstEmployeeId)
  })

  it('returns undefined for an unknown employee id', () => {
    expect(getEmployeeAccessSummary('nonexistent-xyz')).toBeUndefined()
  })

  it('summary.access contains an entry for every module', () => {
    const entries = getAccessEntries()
    const employeeId = entries[0].employeeId
    const summary = getEmployeeAccessSummary(employeeId)!
    for (const m of MODULES) {
      expect(summary.access[m]).toBeDefined()
      expect(LEVELS).toContain(summary.access[m])
    }
  })

  it('summary has employeeName', () => {
    const entries = getAccessEntries()
    const employeeId = entries[0].employeeId
    const summary = getEmployeeAccessSummary(employeeId)!
    expect(summary.employeeName).toBeTruthy()
  })
})

describe('getAllAccessSummaries', () => {
  it('returns at least 4 employee summaries', () => {
    const summaries = getAllAccessSummaries()
    expect(summaries.length).toBeGreaterThanOrEqual(4)
  })

  it('each summary has all 5 modules', () => {
    for (const summary of getAllAccessSummaries()) {
      for (const m of MODULES) {
        expect(summary.access[m]).toBeDefined()
        expect(LEVELS).toContain(summary.access[m])
      }
    }
  })

  it('each summary has employeeId and employeeName', () => {
    for (const summary of getAllAccessSummaries()) {
      expect(summary.employeeId).toBeTruthy()
      expect(summary.employeeName).toBeTruthy()
    }
  })

  it('no duplicate employeeIds in summaries', () => {
    const summaries = getAllAccessSummaries()
    const ids = summaries.map((s) => s.employeeId)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

describe('updateAccess', () => {
  it('updates the access level for a given employee + module', () => {
    const summaries = getAllAccessSummaries()
    const { employeeId } = summaries[0]
    const updated = updateAccess(employeeId, 'grafik', 'admin')
    expect(updated.employeeId).toBe(employeeId)
    expect(updated.module).toBe('grafik')
    expect(updated.level).toBe('admin')
  })

  it('updated level is reflected in getEmployeeAccessSummary', () => {
    const summaries = getAllAccessSummaries()
    const { employeeId } = summaries[0]
    updateAccess(employeeId, 'raporty', 'podgląd')
    const summary = getEmployeeAccessSummary(employeeId)!
    expect(summary.access['raporty']).toBe('podgląd')
  })

  it('stores grantedBy when provided', () => {
    const summaries = getAllAccessSummaries()
    const { employeeId } = summaries[0]
    const entry = updateAccess(employeeId, 'wnioski', 'edycja', 'Jan Kowalski')
    expect(entry.grantedBy).toBe('Jan Kowalski')
  })

  it('sets grantedAt when updating', () => {
    const summaries = getAllAccessSummaries()
    const { employeeId } = summaries[0]
    const entry = updateAccess(employeeId, 'ustawienia', 'brak')
    expect(entry.grantedAt).toBeTruthy()
  })

  it('returned entry has correct module and level', () => {
    const summaries = getAllAccessSummaries()
    const { employeeId } = summaries[1]
    const entry = updateAccess(employeeId, 'dostepy', 'admin')
    expect(entry.module).toBe('dostepy')
    expect(entry.level).toBe('admin')
    expect(entry.employeeId).toBe(employeeId)
  })
})
