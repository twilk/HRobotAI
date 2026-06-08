// Mock access-management data for the reference app.
//
// In the real app this comes from the authenticated tenant runtime.
// Seed data uses employee IDs/names from lib/employees.ts.

export type AccessModule =
  | 'grafik'
  | 'wnioski'
  | 'dostepy'
  | 'raporty'
  | 'ustawienia'

export type AccessLevel = 'brak' | 'podgląd' | 'edycja' | 'admin'

export interface EmployeeAccess {
  id: string
  employeeId: string
  employeeName: string
  module: AccessModule
  level: AccessLevel
  grantedAt?: string
  grantedBy?: string
}

export interface EmployeeAccessSummary {
  employeeId: string
  employeeName: string
  access: Record<AccessModule, AccessLevel>
}

export const MODULE_LABELS: Record<AccessModule, string> = {
  grafik: 'Grafik',
  wnioski: 'Wnioski',
  dostepy: 'Dostępy',
  raporty: 'Raporty',
  ustawienia: 'Ustawienia',
}

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  brak: 'Brak',
  podgląd: 'Podgląd',
  edycja: 'Edycja',
  admin: 'Administrator',
}

const MODULES: AccessModule[] = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']

// Mutable in-memory store (resets on server restart / test module reload)
// Seed: 4 employees × 5 modules = 20 entries with varied access levels.
// Employee IDs match lib/employees.ts seed data.
const ACCESS_ENTRIES: EmployeeAccess[] = [
  // Anna Nowak (id: '1') — Kierownik zmiany; has broad access
  { id: 'da-1-1', employeeId: '1', employeeName: 'Anna Nowak', module: 'grafik',     level: 'edycja',  grantedAt: '2026-01-15T10:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-1-2', employeeId: '1', employeeName: 'Anna Nowak', module: 'wnioski',    level: 'edycja',  grantedAt: '2026-01-15T10:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-1-3', employeeId: '1', employeeName: 'Anna Nowak', module: 'dostepy',    level: 'podgląd', grantedAt: '2026-01-15T10:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-1-4', employeeId: '1', employeeName: 'Anna Nowak', module: 'raporty',    level: 'edycja',  grantedAt: '2026-01-15T10:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-1-5', employeeId: '1', employeeName: 'Anna Nowak', module: 'ustawienia', level: 'brak',    grantedAt: '2026-01-15T10:00:00.000Z', grantedBy: 'Jan Kowalski' },

  // Piotr Wiśniewski (id: '2') — Operator maszyn; limited access
  { id: 'da-2-1', employeeId: '2', employeeName: 'Piotr Wiśniewski', module: 'grafik',     level: 'podgląd', grantedAt: '2026-02-01T09:00:00.000Z', grantedBy: 'Anna Nowak' },
  { id: 'da-2-2', employeeId: '2', employeeName: 'Piotr Wiśniewski', module: 'wnioski',    level: 'edycja',  grantedAt: '2026-02-01T09:00:00.000Z', grantedBy: 'Anna Nowak' },
  { id: 'da-2-3', employeeId: '2', employeeName: 'Piotr Wiśniewski', module: 'dostepy',    level: 'brak',    grantedAt: '2026-02-01T09:00:00.000Z', grantedBy: 'Anna Nowak' },
  { id: 'da-2-4', employeeId: '2', employeeName: 'Piotr Wiśniewski', module: 'raporty',    level: 'brak',    grantedAt: '2026-02-01T09:00:00.000Z', grantedBy: 'Anna Nowak' },
  { id: 'da-2-5', employeeId: '2', employeeName: 'Piotr Wiśniewski', module: 'ustawienia', level: 'brak',    grantedAt: '2026-02-01T09:00:00.000Z', grantedBy: 'Anna Nowak' },

  // Katarzyna Wójcik (id: '3') — Specjalista HR; full HR access
  { id: 'da-3-1', employeeId: '3', employeeName: 'Katarzyna Wójcik', module: 'grafik',     level: 'edycja',  grantedAt: '2026-01-07T08:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-3-2', employeeId: '3', employeeName: 'Katarzyna Wójcik', module: 'wnioski',    level: 'admin',   grantedAt: '2026-01-07T08:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-3-3', employeeId: '3', employeeName: 'Katarzyna Wójcik', module: 'dostepy',    level: 'edycja',  grantedAt: '2026-01-07T08:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-3-4', employeeId: '3', employeeName: 'Katarzyna Wójcik', module: 'raporty',    level: 'admin',   grantedAt: '2026-01-07T08:00:00.000Z', grantedBy: 'Jan Kowalski' },
  { id: 'da-3-5', employeeId: '3', employeeName: 'Katarzyna Wójcik', module: 'ustawienia', level: 'podgląd', grantedAt: '2026-01-07T08:00:00.000Z', grantedBy: 'Jan Kowalski' },

  // Tomasz Kamiński (id: '4') — Magazynier; minimal access
  { id: 'da-4-1', employeeId: '4', employeeName: 'Tomasz Kamiński', module: 'grafik',     level: 'podgląd', grantedAt: '2026-06-03T07:00:00.000Z', grantedBy: 'Marek Zieliński' },
  { id: 'da-4-2', employeeId: '4', employeeName: 'Tomasz Kamiński', module: 'wnioski',    level: 'edycja',  grantedAt: '2026-06-03T07:00:00.000Z', grantedBy: 'Marek Zieliński' },
  { id: 'da-4-3', employeeId: '4', employeeName: 'Tomasz Kamiński', module: 'dostepy',    level: 'brak',    grantedAt: '2026-06-03T07:00:00.000Z', grantedBy: 'Marek Zieliński' },
  { id: 'da-4-4', employeeId: '4', employeeName: 'Tomasz Kamiński', module: 'raporty',    level: 'brak',    grantedAt: '2026-06-03T07:00:00.000Z', grantedBy: 'Marek Zieliński' },
  { id: 'da-4-5', employeeId: '4', employeeName: 'Tomasz Kamiński', module: 'ustawienia', level: 'brak',    grantedAt: '2026-06-03T07:00:00.000Z', grantedBy: 'Marek Zieliński' },
]

/** Return all access entries (flat list). */
export function getAccessEntries(): EmployeeAccess[] {
  return ACCESS_ENTRIES.slice()
}

/** Return a summary for one employee — all 5 modules — or undefined if not found. */
export function getEmployeeAccessSummary(employeeId: string): EmployeeAccessSummary | undefined {
  const entries = ACCESS_ENTRIES.filter((e) => e.employeeId === employeeId)
  if (entries.length === 0) return undefined

  const access = Object.fromEntries(
    MODULES.map((m) => {
      const entry = entries.find((e) => e.module === m)
      return [m, entry?.level ?? 'brak'] as [AccessModule, AccessLevel]
    }),
  ) as Record<AccessModule, AccessLevel>

  return {
    employeeId,
    employeeName: entries[0].employeeName,
    access,
  }
}

/** Return access summaries for all employees in the store. */
export function getAllAccessSummaries(): EmployeeAccessSummary[] {
  const employeeIds = [...new Set(ACCESS_ENTRIES.map((e) => e.employeeId))]
  return employeeIds.map((id) => getEmployeeAccessSummary(id)!)
}

/**
 * Update (or create) an access entry for employeeId + module.
 * Returns the updated EmployeeAccess entry.
 */
export function updateAccess(
  employeeId: string,
  module: AccessModule,
  level: AccessLevel,
  grantedBy?: string,
): EmployeeAccess {
  const idx = ACCESS_ENTRIES.findIndex(
    (e) => e.employeeId === employeeId && e.module === module,
  )
  const now = new Date().toISOString()

  if (idx !== -1) {
    ACCESS_ENTRIES[idx] = {
      ...ACCESS_ENTRIES[idx],
      level,
      grantedAt: now,
      ...(grantedBy !== undefined ? { grantedBy } : {}),
    }
    return ACCESS_ENTRIES[idx]
  }

  // Entry doesn't exist yet — create it
  const existing = ACCESS_ENTRIES.find((e) => e.employeeId === employeeId)
  const employeeName = existing?.employeeName ?? employeeId

  const newEntry: EmployeeAccess = {
    id: `da-${employeeId}-${module}`,
    employeeId,
    employeeName,
    module,
    level,
    grantedAt: now,
    ...(grantedBy !== undefined ? { grantedBy } : {}),
  }
  ACCESS_ENTRIES.push(newEntry)
  return newEntry
}
