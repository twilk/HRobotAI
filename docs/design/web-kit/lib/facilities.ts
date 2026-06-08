// Placówki (facilities) for the reference app.
//
// A Placówka is a concrete site: a name, a lokalizacja (city/region label),
// an adres, the weekly dni i godziny pracy (working days + hours), and the
// pracownicy assigned to it. In the real app this comes from the tenant runtime.

export interface Address {
  street: string
  postalCode: string
  city: string
  country: string
}

/** Open/close in "HH:MM", or null when the placówka is closed that day. */
export type DayHours = { open: string; close: string } | null

/** Index 0 = Poniedziałek … 6 = Niedziela. */
export type WeeklyHours = [DayHours, DayHours, DayHours, DayHours, DayHours, DayHours, DayHours]

export interface Facility {
  id: string
  name: string
  /** Lokalizacja label, e.g. "Warszawa, Mazowieckie". */
  location: string
  address: Address
  hours: WeeklyHours
  /** Assigned employee ids (see lib/employees). */
  employeeIds: string[]
}

export const DAY_LABELS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'] as const
export const DAY_LABELS_LONG = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'] as const

const h = (open: string, close: string): DayHours => ({ open, close })
const X: DayHours = null

const SEED_FACILITIES: Facility[] = [
  {
    id: 'f1',
    name: 'Centrala Warszawa',
    location: 'Warszawa, Mazowieckie',
    address: { street: 'ul. Prosta 12', postalCode: '00-838', city: 'Warszawa', country: 'Polska' },
    hours: [h('08:00', '16:00'), h('08:00', '16:00'), h('08:00', '16:00'), h('08:00', '16:00'), h('08:00', '16:00'), h('09:00', '13:00'), X],
    employeeIds: ['1', '3', '5'],
  },
  {
    id: 'f2',
    name: 'Magazyn Pruszków',
    location: 'Pruszków, Mazowieckie',
    address: { street: 'ul. Logistyczna 4', postalCode: '05-800', city: 'Pruszków', country: 'Polska' },
    hours: [h('06:00', '22:00'), h('06:00', '22:00'), h('06:00', '22:00'), h('06:00', '22:00'), h('06:00', '22:00'), h('06:00', '14:00'), X],
    employeeIds: ['2', '4', '6'],
  },
  {
    id: 'f3',
    name: 'Oddział Kraków',
    location: 'Kraków, Małopolskie',
    address: { street: 'ul. Wielicka 30', postalCode: '30-552', city: 'Kraków', country: 'Polska' },
    hours: [h('08:00', '18:00'), h('08:00', '18:00'), h('08:00', '18:00'), h('08:00', '18:00'), h('08:00', '18:00'), X, X],
    employeeIds: ['1', '4'],
  },
]

/** Deep-clone seed data so mutations don't bleed between test runs. */
function cloneSeed(): Facility[] {
  return SEED_FACILITIES.map((f) => ({
    ...f,
    address: { ...f.address },
    hours: [...f.hours] as WeeklyHours,
    employeeIds: [...f.employeeIds],
  }))
}

let FACILITIES: Facility[] = cloneSeed()

export function getFacilities(): Facility[] {
  return FACILITIES
}

export function getFacility(id: string): Facility | undefined {
  return FACILITIES.find((f) => f.id === id)
}

export function isOpen(facility: Facility, dayIndex: number): boolean {
  return facility.hours[dayIndex] != null
}

export function dayHours(facility: Facility, dayIndex: number): DayHours {
  return facility.hours[dayIndex] ?? null
}

/** "8:00–16:00" or "Zamknięte". Drops a leading zero on the hour for readability. */
export function formatDayHours(dh: DayHours): string {
  if (!dh) return 'Zamknięte'
  return `${trimHour(dh.open)}–${trimHour(dh.close)}`
}

function trimHour(t: string): string {
  return t.replace(/^0(\d)/, '$1')
}

/** Total scheduled open hours across the week (decimal hours). */
export function weeklyOpenHours(facility: Facility): number {
  return facility.hours.reduce((sum, dh) => sum + (dh ? hoursBetween(dh.open, dh.close) : 0), 0)
}

export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return Math.max(0, eh * 60 + em - (sh * 60 + sm)) / 60
}

/** Pure update: returns a new facility with one day's hours replaced. */
export function updateFacilityHours(facility: Facility, dayIndex: number, hours: DayHours): Facility {
  const next = [...facility.hours] as WeeklyHours
  next[dayIndex] = hours
  return { ...facility, hours: next }
}

// ---- mutable store mutations ----

/** Set the full weekly hours for a facility in the store. Returns updated facility or undefined. */
export function setFacilityHours(facilityId: string, hours: WeeklyHours): Facility | undefined {
  let updated: Facility | undefined
  FACILITIES = FACILITIES.map((f) => {
    if (f.id !== facilityId) return f
    updated = { ...f, hours: [...hours] as WeeklyHours }
    return updated
  })
  return updated
}

/** Patch address fields for a facility in the store. Returns updated facility or undefined. */
export function setFacilityAddress(facilityId: string, address: Partial<Address>): Facility | undefined {
  let updated: Facility | undefined
  FACILITIES = FACILITIES.map((f) => {
    if (f.id !== facilityId) return f
    updated = { ...f, address: { ...f.address, ...address } }
    return updated
  })
  return updated
}

/** Reset the in-memory store to seed data (for tests). */
export function resetFacilities(): void {
  FACILITIES = cloneSeed()
}
