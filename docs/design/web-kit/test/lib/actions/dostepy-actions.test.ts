import { describe, it, expect } from 'vitest'
import {
  updateEmployeeAccess,
  updateAllEmployeeAccess,
} from '@/lib/actions/dostepy-actions'
import { getAccessEntries, getEmployeeAccessSummary, type AccessModule, type AccessLevel } from '@/lib/dostepy'

// The dostepy store uses module-level mutable state with seed data for employees '1'–'4'.
// We use existing employee ids and check that mutations persist.

describe('updateEmployeeAccess', () => {
  it('sets the correct access level for a module', async () => {
    const result = await updateEmployeeAccess('1', 'grafik', 'admin', 'hr@hrobot.ai')
    expect(result.success).toBe(true)
    const entries = getAccessEntries()
    const entry = entries.find((e) => e.employeeId === '1' && e.module === 'grafik')
    expect(entry?.level).toBe('admin')
  })

  it('updates grantedBy on the entry', async () => {
    await updateEmployeeAccess('2', 'wnioski', 'podgląd', 'manager@hrobot.ai')
    const entries = getAccessEntries()
    const entry = entries.find((e) => e.employeeId === '2' && e.module === 'wnioski')
    expect(entry?.grantedBy).toBe('manager@hrobot.ai')
  })

  it('creates a new entry when employee + module not previously in store', async () => {
    const before = getAccessEntries().length
    const result = await updateEmployeeAccess('new-emp-99', 'raporty', 'podgląd', 'hr@hrobot.ai')
    expect(result.success).toBe(true)
    const after = getAccessEntries()
    expect(after.length).toBe(before + 1)
    const entry = after.find((e) => e.employeeId === 'new-emp-99' && e.module === 'raporty')
    expect(entry?.level).toBe('podgląd')
  })

  it('rejects an invalid module name', async () => {
    const result = await updateEmployeeAccess('1', 'invalid-module' as AccessModule, 'edycja', 'admin')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects an invalid access level', async () => {
    const result = await updateEmployeeAccess('1', 'grafik', 'superadmin' as AccessLevel, 'admin')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('updateAllEmployeeAccess', () => {
  it('sets all 5 module access levels at once', async () => {
    const accessMap: Record<AccessModule, AccessLevel> = {
      grafik: 'edycja',
      wnioski: 'podgląd',
      dostepy: 'brak',
      raporty: 'edycja',
      ustawienia: 'admin',
    }
    const result = await updateAllEmployeeAccess('3', accessMap, 'superadmin@hrobot.ai')
    expect(result.success).toBe(true)

    const summary = getEmployeeAccessSummary('3')
    expect(summary?.access.grafik).toBe('edycja')
    expect(summary?.access.wnioski).toBe('podgląd')
    expect(summary?.access.dostepy).toBe('brak')
    expect(summary?.access.raporty).toBe('edycja')
    expect(summary?.access.ustawienia).toBe('admin')
  })

  it('returns success for a new employee id (creates all 5 entries)', async () => {
    const accessMap: Record<AccessModule, AccessLevel> = {
      grafik: 'brak',
      wnioski: 'brak',
      dostepy: 'brak',
      raporty: 'brak',
      ustawienia: 'brak',
    }
    const result = await updateAllEmployeeAccess('new-bulk-emp', accessMap, 'hr@hrobot.ai')
    expect(result.success).toBe(true)
    const summary = getEmployeeAccessSummary('new-bulk-emp')
    expect(summary).toBeDefined()
    const levels = Object.values(summary!.access)
    expect(levels.every((l) => l === 'brak')).toBe(true)
  })
})
