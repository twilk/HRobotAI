// Grafik (work schedule) domain: shifts + the week/date math that drives the grid.
// Pure + deterministic (no Date.now at module load) so it is easy to unit-test.

export interface Shift {
  id: string
  employeeId: string
  facilityId: string
  /** Absolute day, 'YYYY-MM-DD'. */
  date: string
  start: string // 'HH:MM'
  end: string // 'HH:MM'
  /** Optional role/position label for this shift. */
  role?: string
}

/** Reference data keyed by weekday (0 = Pon … 6 = Nd) so any shown week is populated. */
export interface SeedShift {
  employeeId: string
  facilityId: string
  dayIndex: number
  start: string
  end: string
}

// ---- date helpers (Monday-based weeks) ----

/** Monday 00:00 of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const mondayIndex = (x.getDay() + 6) % 7 // Mon=0 … Sun=6
  x.setDate(x.getDate() - mondayIndex)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** 'YYYY-MM-DD' in local time (not UTC, so it matches the displayed day). */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The seven Date objects of a week (Mon … Sun) from a Monday start. */
export function weekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** "1.7" style day-of-month + month, for column headers. */
export function formatDayDate(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}`
}

export function isSameDay(d: Date, iso: string): boolean {
  return ymd(d) === iso
}

// ---- hours ----

export function minutesOf(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function shiftHours(s: Pick<Shift, 'start' | 'end'>): number {
  return Math.max(0, minutesOf(s.end) - minutesOf(s.start)) / 60
}

export function employeeWeekHours(shifts: Shift[], employeeId: string): number {
  return shifts.filter((s) => s.employeeId === employeeId).reduce((sum, s) => sum + shiftHours(s), 0)
}

// ---- materialization ----

export const SEED_SHIFTS: SeedShift[] = [
  // f1 — Centrala Warszawa (office, Pon–Pt 8–16)
  { employeeId: '1', facilityId: 'f1', dayIndex: 0, start: '08:00', end: '16:00' },
  { employeeId: '1', facilityId: 'f1', dayIndex: 2, start: '08:00', end: '16:00' },
  { employeeId: '1', facilityId: 'f1', dayIndex: 4, start: '08:00', end: '14:00' },
  { employeeId: '3', facilityId: 'f1', dayIndex: 0, start: '09:00', end: '17:00' },
  { employeeId: '3', facilityId: 'f1', dayIndex: 1, start: '09:00', end: '17:00' },
  { employeeId: '3', facilityId: 'f1', dayIndex: 3, start: '09:00', end: '17:00' },
  { employeeId: '5', facilityId: 'f1', dayIndex: 1, start: '08:00', end: '16:00' },
  { employeeId: '5', facilityId: 'f1', dayIndex: 4, start: '08:00', end: '16:00' },
  // f2 — Magazyn Pruszków (shifts, Pon–Sob 6–22)
  { employeeId: '2', facilityId: 'f2', dayIndex: 0, start: '06:00', end: '14:00' },
  { employeeId: '2', facilityId: 'f2', dayIndex: 1, start: '06:00', end: '14:00' },
  { employeeId: '2', facilityId: 'f2', dayIndex: 2, start: '14:00', end: '22:00' },
  { employeeId: '4', facilityId: 'f2', dayIndex: 0, start: '14:00', end: '22:00' },
  { employeeId: '4', facilityId: 'f2', dayIndex: 3, start: '06:00', end: '14:00' },
  { employeeId: '4', facilityId: 'f2', dayIndex: 5, start: '06:00', end: '14:00' },
  { employeeId: '6', facilityId: 'f2', dayIndex: 1, start: '14:00', end: '22:00' },
  { employeeId: '6', facilityId: 'f2', dayIndex: 4, start: '14:00', end: '22:00' },
  // f3 — Oddział Kraków (Pon–Pt 8–18)
  { employeeId: '1', facilityId: 'f3', dayIndex: 1, start: '10:00', end: '18:00' },
  { employeeId: '4', facilityId: 'f3', dayIndex: 2, start: '08:00', end: '16:00' },
]

let shiftCounter = 0
/** Client-only id generator for newly added shifts. */
export function newShiftId(): string {
  shiftCounter += 1
  return `s-new-${shiftCounter}`
}

// ---- in-memory shift store ----

let SHIFT_STORE: Shift[] = []

/** Return all stored shifts, optionally filtered by facilityId and/or weekStart (YYYY-MM-DD of Monday). */
export function getShifts(facilityId?: string, weekStart?: string): Shift[] {
  let result = SHIFT_STORE
  if (facilityId !== undefined) {
    result = result.filter((s) => s.facilityId === facilityId)
  }
  if (weekStart !== undefined) {
    // Include shifts whose date falls within the 7-day window Mon … Sun
    const start = weekStart
    const endDate = new Date(weekStart)
    endDate.setDate(endDate.getDate() + 6)
    const end = ymd(endDate)
    result = result.filter((s) => s.date >= start && s.date <= end)
  }
  return result
}

/** Add a new shift to the store. Returns the stored shift with a generated id. */
export function addShift(shift: Omit<Shift, 'id'>): Shift {
  const stored: Shift = { id: newShiftId(), ...shift }
  SHIFT_STORE = [...SHIFT_STORE, stored]
  return stored
}

/** Remove a shift by id. Returns true if found and removed, false if not found. */
export function removeShift(shiftId: string): boolean {
  const before = SHIFT_STORE.length
  SHIFT_STORE = SHIFT_STORE.filter((s) => s.id !== shiftId)
  return SHIFT_STORE.length < before
}

/** Patch a shift by id. Returns the updated shift, or undefined if not found. */
export function updateShift(shiftId: string, patch: Partial<Omit<Shift, 'id'>>): Shift | undefined {
  let updated: Shift | undefined
  SHIFT_STORE = SHIFT_STORE.map((s) => {
    if (s.id !== shiftId) return s
    updated = { ...s, ...patch }
    return updated
  })
  return updated
}

/** Reset the in-memory store (for tests). */
export function resetShifts(): void {
  SHIFT_STORE = []
  shiftCounter = 0
}

/** Turn the weekday-keyed seed into dated shifts for a given facility + week. */
export function materializeWeek(seed: SeedShift[], weekStart: Date, facilityId: string): Shift[] {
  return seed
    .filter((s) => s.facilityId === facilityId)
    .map((s, i) => ({
      id: `s-${facilityId}-${s.employeeId}-${s.dayIndex}-${i}`,
      employeeId: s.employeeId,
      facilityId: s.facilityId,
      date: ymd(addDays(weekStart, s.dayIndex)),
      start: s.start,
      end: s.end,
    }))
}
