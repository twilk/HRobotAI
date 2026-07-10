import { EmploymentType } from '@hrobot/shared'
import { md5Bytes, pick, stableId } from './determinism.js'
import { generateSyntheticPesel, type SyntheticPesel } from './pesel.js'

/**
 * The FROZEN canonical synthetic dataset (M2 subproject #4, spec §6 "Dane UAT").
 *
 * This module is PURE: it derives the whole dataset — units, ~15 locations, 36 employees, approved
 * leaves, shift templates and two weeks of demand — as plain data with zero DB/Prisma/crypto
 * dependency, so Tor C (agent cold-start) and Tor E (UAT) can `import` the exact same frozen set the
 * runner writes. Every id is a UUIDv5 of a stable natural key and every choice is index-derived, so
 * two builds are byte-identical (determinism; see ./determinism.ts). The DB-writing + PII-encryption
 * concerns live in `scripts/seed-synthetic.ts`, never here.
 *
 * RODO: all data is invented. PESELs come only from generateSyntheticPesel(); home addresses are
 * fictional; coordinates are public city geolocations, not personal data.
 */

// --- roles ---------------------------------------------------------------------------------------

/**
 * The scheduling roles used as both `Employee.qualifications` and `ShiftDemand.requiredRole`.
 * KOORDYNATOR is intentionally SCARCE (only 3 employees company-wide) — that scarcity, combined with
 * approved leave, is what makes the infeasible week infeasible. See {@link CANONICAL_WEEKS}.
 */
export const ROLE = {
  KIEROWCA: 'KIEROWCA', // driver — the bulk role
  SERWISANT: 'SERWISANT', // fleet service technician
  RECEPCJA: 'RECEPCJA', // front desk
  KOORDYNATOR: 'KOORDYNATOR', // shift coordinator — SCARCE
} as const
export type Role = (typeof ROLE)[keyof typeof ROLE]

/** Facility types. `Lokalizacja.typ` uses these and they match `ShiftTemplate.lokalizacjaTyp`. */
export const FACILITY = {
  LOTNISKO: 'LOTNISKO', // airport ground-service point
  STACJA_MIEJSKA: 'STACJA_MIEJSKA', // city mobility station
  SERWIS: 'SERWIS', // fleet service depot
} as const
export type Facility = (typeof FACILITY)[keyof typeof FACILITY]

// --- emitted shapes (Prisma-agnostic) ------------------------------------------------------------

export interface SeedUnit {
  id: string
  name: string
  parentId: string | null
}

export interface SeedLocation {
  id: string
  name: string
  typ: Facility
  lat: number
  lng: number
}

export interface SeedEmployee {
  id: string
  firstName: string
  lastName: string
  /** Branded synthetic PESEL — the runner asserts the brand before encrypting (RODO guard). */
  pesel: SyntheticPesel
  position: string
  employmentType: EmploymentType
  /** ISO `YYYY-MM-DD`. */
  hiredAt: string
  unitId: string
  /** Contract fraction; targetWeeklyHours = etat × 40. */
  etat: number
  qualifications: Role[]
  /** Fictional street address — the runner ENCRYPTS this before persisting (RODO PII). */
  homeAddress: string
  homeLat: number
  homeLng: number
  /**
   * SOFT synthetic preferences derived from `md5(id)` (see {@link derivePreferences}). Weekday codes
   * (`MON`..`SUN`) the employee would rather NOT work. May be empty; never affects feasibility.
   */
  preferredDaysOff: string[]
  /** SOFT preferred shift start times as `HH:mm`, drawn from the seed's template starts. May be empty. */
  preferredShiftStart: string[]
}

export interface SeedLeave {
  id: string
  employeeId: string
  /** ISO `YYYY-MM-DD`, closed interval [startDate, endDate]. */
  startDate: string
  endDate: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  type: string
}

export interface DemandWindow {
  start: string
  end: string
  rola: Role
  liczba: number
}

export interface SeedTemplate {
  id: string
  lokalizacjaTyp: Facility
  nazwa: string
  dni: string[]
  okna: DemandWindow[]
}

export interface SeedDemand {
  id: string
  lokalizacjaId: string
  /** ISO `YYYY-MM-DD`. */
  date: string
  start: string
  end: string
  requiredRole: Role
  requiredCount: number
  source: 'TEMPLATE' | 'MANUAL'
}

export interface CanonicalSeed {
  units: SeedUnit[]
  locations: SeedLocation[]
  employees: SeedEmployee[]
  leaves: SeedLeave[]
  templates: SeedTemplate[]
  demands: SeedDemand[]
}

// --- static source tables ------------------------------------------------------------------------

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const
const WORK_WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const

const MALE_NAMES = [
  'Jan', 'Piotr', 'Andrzej', 'Krzysztof', 'Tomasz', 'Marcin', 'Paweł', 'Michał', 'Marek',
  'Grzegorz', 'Adam', 'Rafał', 'Jacek', 'Robert', 'Łukasz',
] as const
const FEMALE_NAMES = [
  'Anna', 'Maria', 'Katarzyna', 'Małgorzata', 'Agnieszka', 'Barbara', 'Ewa', 'Krystyna',
  'Magdalena', 'Joanna', 'Monika', 'Zofia', 'Teresa', 'Beata', 'Aleksandra',
] as const
const SURNAMES = [
  'Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski',
  'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur',
  'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Nowakowski', 'Pawłowski', 'Michalski',
  'Nowicki', 'Adamczyk', 'Dudek', 'Zając', 'Wieczorek', 'Jabłoński', 'Król', 'Majewski',
  'Olszewski', 'Jaworski', 'Wróbel', 'Malinowski', 'Pawlak', 'Witkowski', 'Górski',
] as const

/** City anchor coordinates (public geolocation, not PII) an employee's synthetic home derives from. */
const CITIES = [
  { name: 'Warszawa', postal: '00-001', lat: 52.2297, lng: 21.0122 },
  { name: 'Kraków', postal: '30-001', lat: 50.0647, lng: 19.945 },
  { name: 'Gdańsk', postal: '80-001', lat: 54.352, lng: 18.6466 },
  { name: 'Wrocław', postal: '50-001', lat: 51.1079, lng: 17.0385 },
  { name: 'Poznań', postal: '60-001', lat: 52.4064, lng: 16.9252 },
  { name: 'Katowice', postal: '40-001', lat: 50.2649, lng: 19.0238 },
  { name: 'Łódź', postal: '90-001', lat: 51.7592, lng: 19.456 },
  { name: 'Szczecin', postal: '70-001', lat: 53.4285, lng: 14.5528 },
  { name: 'Lublin', postal: '20-001', lat: 51.2465, lng: 22.5684 },
  { name: 'Rzeszów', postal: '35-001', lat: 50.0413, lng: 21.999 },
] as const

const STREETS = [
  'Aleja Mobilności', 'ul. Lotnicza', 'ul. Flotowa', 'ul. Postojowa', 'ul. Serwisowa',
  'ul. Kierowców', 'ul. Dyżurna', 'ul. Zmianowa',
] as const

const EMPLOYMENT_CYCLE = [
  EmploymentType.UMOWA_O_PRACE,
  EmploymentType.UMOWA_O_PRACE,
  EmploymentType.UMOWA_ZLECENIE,
  EmploymentType.UMOWA_O_PRACE,
  EmploymentType.B2B,
  EmploymentType.UMOWA_O_DZIELO,
] as const

const ETAT_CYCLE = [1.0, 1.0, 0.75, 1.0, 0.5, 1.0, 0.8, 0.5] as const

export const EMPLOYEE_COUNT = 36

// --- locations -----------------------------------------------------------------------------------

interface LocSource {
  key: string
  name: string
  typ: Facility
  lat: number
  lng: number
}

/** ~15 locations in 4Mobility's operational shape (airport + city stations + service depots). */
const LOCATION_SOURCES: LocSource[] = [
  { key: 'waw-lotnisko', name: 'Lotnisko Chopina — Warszawa', typ: FACILITY.LOTNISKO, lat: 52.1657, lng: 20.9671 },
  { key: 'waw-stacja', name: 'Stacja Mobilności — Warszawa Centrum', typ: FACILITY.STACJA_MIEJSKA, lat: 52.2297, lng: 21.0122 },
  { key: 'waw-serwis', name: 'Serwis Floty — Warszawa Wola', typ: FACILITY.SERWIS, lat: 52.236, lng: 20.96 },
  { key: 'krk-lotnisko', name: 'Lotnisko Kraków-Balice', typ: FACILITY.LOTNISKO, lat: 50.0777, lng: 19.7848 },
  { key: 'krk-stacja', name: 'Stacja Mobilności — Kraków Rynek', typ: FACILITY.STACJA_MIEJSKA, lat: 50.0619, lng: 19.9368 },
  { key: 'gdn-lotnisko', name: 'Lotnisko Gdańsk im. L. Wałęsy', typ: FACILITY.LOTNISKO, lat: 54.3776, lng: 18.4662 },
  { key: 'gdn-stacja', name: 'Stacja Mobilności — Gdańsk Wrzeszcz', typ: FACILITY.STACJA_MIEJSKA, lat: 54.381, lng: 18.6 },
  { key: 'wro-lotnisko', name: 'Lotnisko Wrocław-Strachowice', typ: FACILITY.LOTNISKO, lat: 51.1027, lng: 16.8858 },
  { key: 'wro-stacja', name: 'Stacja Mobilności — Wrocław Rynek', typ: FACILITY.STACJA_MIEJSKA, lat: 51.11, lng: 17.03 },
  { key: 'poz-lotnisko', name: 'Lotnisko Poznań-Ławica', typ: FACILITY.LOTNISKO, lat: 52.421, lng: 16.8263 },
  { key: 'poz-stacja', name: 'Stacja Mobilności — Poznań Centrum', typ: FACILITY.STACJA_MIEJSKA, lat: 52.4064, lng: 16.9252 },
  { key: 'kat-lotnisko', name: 'Lotnisko Katowice-Pyrzowice', typ: FACILITY.LOTNISKO, lat: 50.4743, lng: 19.08 },
  { key: 'lodz-stacja', name: 'Stacja Mobilności — Łódź Centrum', typ: FACILITY.STACJA_MIEJSKA, lat: 51.7592, lng: 19.456 },
  { key: 'szc-serwis', name: 'Serwis Floty — Szczecin', typ: FACILITY.SERWIS, lat: 53.4285, lng: 14.5528 },
  { key: 'lub-stacja', name: 'Stacja Mobilności — Lublin', typ: FACILITY.STACJA_MIEJSKA, lat: 51.2465, lng: 22.5684 },
]

function buildLocations(): SeedLocation[] {
  return LOCATION_SOURCES.map((l) => ({
    id: stableId('lokalizacja', l.key),
    name: l.name,
    typ: l.typ,
    lat: l.lat,
    lng: l.lng,
  }))
}

// --- organizational units ------------------------------------------------------------------------

const REGION_NAMES = ['Region Północ', 'Region Centrum', 'Region Południe'] as const

function buildUnits(): SeedUnit[] {
  const root: SeedUnit = { id: stableId('unit', 'root'), name: '4Mobility — Operacje', parentId: null }
  const regions = REGION_NAMES.map((name) => ({
    id: stableId('unit', name),
    name,
    parentId: root.id,
  }))
  return [root, ...regions]
}

// --- employees -----------------------------------------------------------------------------------

/** Feminize a masculine `-ski/-cki/-dzki` surname; other surnames are returned unchanged. */
function feminizeSurname(surname: string): string {
  return surname.replace(/ski$/, 'ska').replace(/cki$/, 'cka').replace(/dzki$/, 'dzka')
}

/**
 * Qualification distribution across the 36 employees. Deliberately makes KOORDYNATOR scarce (exactly
 * 3: indices 0,1,2) while keeping every other role plentiful, so the coverage of the infeasible week
 * hinges only on the coordinators. Everyone ends up with ≥1 role.
 */
function qualificationsFor(index: number): Role[] {
  const q = new Set<Role>()
  if (index < 3) q.add(ROLE.KOORDYNATOR) // scarce: exactly 3 coordinators company-wide
  if (index % 5 !== 4) q.add(ROLE.KIEROWCA) // ~80% are drivers
  if (index % 3 === 0 || index % 3 === 1) q.add(ROLE.SERWISANT) // ~2/3 can service
  if (index % 4 === 0 || index % 7 === 3) q.add(ROLE.RECEPCJA) // front-desk spread
  if (q.size === 0) q.add(ROLE.KIEROWCA) // never leave anyone role-less
  return [...q]
}

/** Job title from the highest-priority qualification held. */
function positionFor(quals: Role[]): string {
  if (quals.includes(ROLE.KOORDYNATOR)) return 'Koordynator zmiany'
  if (quals.includes(ROLE.RECEPCJA)) return 'Recepcjonista'
  if (quals.includes(ROLE.SERWISANT)) return 'Serwisant floty'
  return 'Kierowca'
}

function isoDatePlusDays(baseIso: string, days: number): string {
  const base = new Date(`${baseIso}T00:00:00.000Z`)
  const d = new Date(base.getTime() + days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/** Distinct shift-template start times (`HH:mm`, sorted) — the DOMAIN `preferredShiftStart` draws from. */
export function templateStartTimes(templates: SeedTemplate[]): string[] {
  const starts = new Set<string>()
  for (const t of templates) for (const w of t.okna) starts.add(w.start)
  return [...starts].sort()
}

/**
 * Derive one employee's SOFT synthetic preferences from `md5(<stable employee id>)`. Deterministic and
 * idempotent — the same id always yields the same preferences, so re-seeding is a no-op and Tor C/UAT
 * see a byte-identical set. Preferences are SOFT: {@link weekCoverage} ignores them, so this NEVER
 * changes which week is feasible vs infeasible.
 *
 *   - `preferredDaysOff`: 0–2 distinct weekday codes. `hash[0] % 3` sets the count, so ~1/3 of
 *     employees get none (a realistic "no strong preference" cohort) while the distribution stays fixed.
 *   - `preferredShiftStart`: 0–1 start time. `hash[3]` even → one value drawn from `templateStarts`
 *     (always a real template start, so it is a schedulable time), else none.
 */
export function derivePreferences(
  employeeId: string,
  templateStarts: readonly string[],
): { preferredDaysOff: string[]; preferredShiftStart: string[] } {
  const h = md5Bytes(employeeId)
  const count = h[0]! % 3 // 0, 1, or 2 preferred days off
  const preferredDaysOff: string[] = []
  for (let k = 0; k < count; k++) {
    const code = DOW[h[1 + k]! % DOW.length]!
    if (!preferredDaysOff.includes(code)) preferredDaysOff.push(code) // keep distinct
  }
  const wantsStart = h[3]! % 2 === 0 && templateStarts.length > 0
  const preferredShiftStart = wantsStart ? [templateStarts[h[4]! % templateStarts.length]!] : []
  return { preferredDaysOff, preferredShiftStart }
}

function buildEmployees(units: SeedUnit[], templateStarts: readonly string[]): SeedEmployee[] {
  const regions = units.filter((u) => u.parentId !== null)
  const out: SeedEmployee[] = []
  for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const sex: 'M' | 'F' = i % 2 === 0 ? 'M' : 'F'
    const firstName = sex === 'M' ? pick(MALE_NAMES, Math.floor(i / 2)) : pick(FEMALE_NAMES, Math.floor(i / 2))
    const rawSurname = pick(SURNAMES, i)
    const lastName = sex === 'F' ? feminizeSurname(rawSurname) : rawSurname
    const quals = qualificationsFor(i)
    const city = pick(CITIES, i)
    // Deterministic small offset so homes don't all sit on the exact city centroid.
    const latJitter = ((i % 7) - 3) * 0.01
    const lngJitter = ((i % 5) - 2) * 0.01
    const street = pick(STREETS, i)
    const houseNo = (i % 90) + 1
    // Natural key for the id/PESEL: index is enough since names/quals are index-derived.
    const naturalKey = `emp-${i}`
    const id = stableId('employee', naturalKey)
    // SOFT preferences hash off the STABLE id (not the index), so they travel with identity.
    const { preferredDaysOff, preferredShiftStart } = derivePreferences(id, templateStarts)
    out.push({
      id,
      firstName,
      lastName,
      pesel: generateSyntheticPesel(i, sex),
      position: positionFor(quals),
      employmentType: pick(EMPLOYMENT_CYCLE, i),
      hiredAt: isoDatePlusDays('2019-01-07', i * 37), // spread hires across ~3.6 years
      unitId: pick(regions, i).id,
      etat: pick(ETAT_CYCLE, i),
      qualifications: quals,
      homeAddress: `${street} ${houseNo}, ${city.postal} ${city.name}`,
      homeLat: Number((city.lat + latJitter).toFixed(6)),
      homeLng: Number((city.lng + lngJitter).toFixed(6)),
      preferredDaysOff,
      preferredShiftStart,
    })
  }
  return out
}

// --- shift templates -----------------------------------------------------------------------------

function buildTemplates(): SeedTemplate[] {
  return [
    {
      id: stableId('template', FACILITY.LOTNISKO),
      lokalizacjaTyp: FACILITY.LOTNISKO,
      nazwa: 'Lotnisko — obsada dobowa',
      dni: [...DOW],
      okna: [
        { start: '06:00', end: '14:00', rola: ROLE.KIEROWCA, liczba: 2 },
        { start: '06:00', end: '14:00', rola: ROLE.RECEPCJA, liczba: 1 },
        { start: '14:00', end: '22:00', rola: ROLE.KIEROWCA, liczba: 2 },
        { start: '14:00', end: '22:00', rola: ROLE.KOORDYNATOR, liczba: 1 },
      ],
    },
    {
      id: stableId('template', FACILITY.STACJA_MIEJSKA),
      lokalizacjaTyp: FACILITY.STACJA_MIEJSKA,
      nazwa: 'Stacja miejska — dzień roboczy',
      dni: [...WORK_WEEK],
      okna: [
        { start: '08:00', end: '16:00', rola: ROLE.KIEROWCA, liczba: 1 },
        { start: '08:00', end: '16:00', rola: ROLE.SERWISANT, liczba: 1 },
      ],
    },
    {
      id: stableId('template', FACILITY.SERWIS),
      lokalizacjaTyp: FACILITY.SERWIS,
      nazwa: 'Serwis floty — dzień roboczy',
      dni: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
      okna: [{ start: '07:00', end: '15:00', rola: ROLE.SERWISANT, liczba: 2 }],
    },
  ]
}

// --- weeks + demand ------------------------------------------------------------------------------

/**
 * The two demonstration weeks (spec §6 feasibility). Both draw demand from the SAME two Warsaw
 * locations expanded from templates; the infeasible week adds a coordinator spike + removes 2 of the
 * 3 coordinators via approved leave. `expectFeasible` is asserted by the colocated test through
 * {@link weekCoverage}.
 */
export const CANONICAL_WEEKS = {
  feasible: {
    weekStart: '2026-07-13', // Monday
    expectFeasible: true,
    note:
      'FEASIBLE: every (date, role) is coverable. Coordinator demand is ≤1/day and all 3 coordinators ' +
      'are available; drivers/reception/service pools far exceed the ≤5/1/1 daily need. One approved ' +
      'leave (a driver, 13–15 Jul) does not drop any role below its requirement.',
  },
  infeasible: {
    weekStart: '2026-07-20', // Monday
    expectFeasible: false,
    note:
      'INFEASIBLE: KOORDYNATOR is scarce (only 3 exist) and 2 are on APPROVED leave all week, leaving 1. ' +
      'Wednesday 22 Jul needs 3 coordinator-bodies (template afternoon ×1 + a MANUAL morning spike ×2), ' +
      'so it cannot be staffed. A PENDING coordinator leave is included to prove only APPROVED leave bites.',
  },
} as const

// The demonstration weeks schedule against the two Warsaw locations ('waw-lotnisko', 'waw-stacja')
// resolved in buildDemands — kept small so the coverage counting stays tractable and documented.

function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => isoDatePlusDays(weekStart, i))
}

/** Expand a template into demand rows for a week, one row per (day-in-`dni`, window). */
function expandTemplate(
  template: SeedTemplate,
  locationId: string,
  weekStart: string,
  weekLabel: string,
): SeedDemand[] {
  const dates = weekDates(weekStart)
  const out: SeedDemand[] = []
  dates.forEach((date, i) => {
    const dow = DOW[i]!
    if (!template.dni.includes(dow)) return
    for (const w of template.okna) {
      out.push({
        id: stableId('demand', weekLabel, locationId, date, w.start, w.rola),
        lokalizacjaId: locationId,
        date,
        start: w.start,
        end: w.end,
        requiredRole: w.rola,
        requiredCount: w.liczba,
        source: 'TEMPLATE',
      })
    }
  })
  return out
}

function buildDemands(locations: SeedLocation[], templates: SeedTemplate[]): SeedDemand[] {
  const byKeyId = new Map(LOCATION_SOURCES.map((l, idx) => [l.key, locations[idx]!.id]))
  const byTyp = new Map(templates.map((t) => [t.lokalizacjaTyp, t]))
  const lotniskoId = byKeyId.get('waw-lotnisko')!
  const stacjaId = byKeyId.get('waw-stacja')!
  const lotniskoTpl = byTyp.get(FACILITY.LOTNISKO)!
  const stacjaTpl = byTyp.get(FACILITY.STACJA_MIEJSKA)!

  const out: SeedDemand[] = []
  for (const week of [CANONICAL_WEEKS.feasible, CANONICAL_WEEKS.infeasible]) {
    const label = week.expectFeasible ? 'feasible' : 'infeasible'
    out.push(...expandTemplate(lotniskoTpl, lotniskoId, week.weekStart, label))
    out.push(...expandTemplate(stacjaTpl, stacjaId, week.weekStart, label))
  }

  // Infeasible-week coordinator spike: a MANUAL morning need for TWO coordinators on Wed 22 Jul. With
  // only 1 coordinator not on leave, this (plus the template afternoon ×1) cannot be met — the
  // deliberate infeasibility. Kept MANUAL so it reads as an operational one-off, not a template.
  out.push({
    id: stableId('demand', 'infeasible', lotniskoId, 'koordynator-spike'),
    lokalizacjaId: lotniskoId,
    date: '2026-07-22',
    start: '06:00',
    end: '14:00',
    requiredRole: ROLE.KOORDYNATOR,
    requiredCount: 2,
    source: 'MANUAL',
  })
  return out
}

// --- leaves --------------------------------------------------------------------------------------

function buildLeaves(employees: SeedEmployee[]): SeedLeave[] {
  const byIndexKey = (i: number): string => employees[i]!.id
  const leave = (
    natKey: string,
    empIndex: number,
    startDate: string,
    endDate: string,
    status: SeedLeave['status'],
    type: string,
  ): SeedLeave => ({
    id: stableId('leave', natKey),
    employeeId: byIndexKey(empIndex),
    startDate,
    endDate,
    status,
    type,
  })

  return [
    // Infeasibility driver: coordinators #1 and #2 (of 0,1,2) out all of the infeasible week.
    leave('koord-1-urlop', 1, '2026-07-20', '2026-07-26', 'APPROVED', 'URLOP_WYPOCZYNKOWY'),
    leave('koord-2-urlop', 2, '2026-07-20', '2026-07-26', 'APPROVED', 'URLOP_WYPOCZYNKOWY'),
    // PENDING leave for coordinator #0 in the same week: proves only APPROVED leave feeds the solver.
    // Because it is PENDING, coordinator #0 stays available (→ exactly 1 coordinator that week).
    leave('koord-0-pending', 0, '2026-07-20', '2026-07-26', 'PENDING', 'URLOP_NA_ZADANIE'),
    // Realism leaves in the infeasible week on plentiful driver roles — do NOT drop any role below need.
    leave('driver-5-urlop', 5, '2026-07-20', '2026-07-24', 'APPROVED', 'URLOP_WYPOCZYNKOWY'),
    leave('driver-10-urlop', 10, '2026-07-21', '2026-07-23', 'APPROVED', 'URLOP_WYPOCZYNKOWY'),
    // A leave overlapping the FEASIBLE week (a driver, 13–15 Jul): present, but the week stays feasible.
    leave('driver-20-urlop', 20, '2026-07-13', '2026-07-15', 'APPROVED', 'URLOP_WYPOCZYNKOWY'),
  ]
}

// --- assembly ------------------------------------------------------------------------------------

/**
 * Build the entire canonical dataset. Pure and deterministic: same output every call, so importers
 * and the runner agree byte-for-byte. Call {@link assertCanonicalInvariants} to fail loud if a future
 * edit breaks the frozen guarantees.
 */
export function buildCanonicalSeed(): CanonicalSeed {
  const units = buildUnits()
  const locations = buildLocations()
  const templates = buildTemplates()
  // Templates first: SOFT employee preferences draw their preferredShiftStart from the template starts.
  const employees = buildEmployees(units, templateStartTimes(templates))
  const demands = buildDemands(locations, templates)
  const leaves = buildLeaves(employees)
  return { units, locations, employees, leaves, templates, demands }
}

// --- feasibility check ---------------------------------------------------------------------------

export interface Shortfall {
  date: string
  role: Role
  required: number
  available: number
}

export interface CoverageResult {
  feasible: boolean
  shortfalls: Shortfall[]
}

/** True iff `date` (ISO) falls inside the closed interval of an APPROVED leave for `employeeId`. */
function onApprovedLeave(leaves: SeedLeave[], employeeId: string, date: string): boolean {
  return leaves.some(
    (l) =>
      l.employeeId === employeeId &&
      l.status === 'APPROVED' &&
      l.startDate <= date &&
      date <= l.endDate,
  )
}

/**
 * A NECESSARY coverage condition for a solve week: for every (date, role), the number of employees
 * who hold the role AND are not on APPROVED leave that date must meet the summed required count.
 * Requirements are summed across concurrent windows (a conservative over-count of distinct bodies),
 * and the dataset keeps generous etat/hours slack, so this coverage gate is the binding constraint —
 * exactly the property the two demonstration weeks are designed around. Mirrors the solver's H3
 * (approved-leave) hard block; it does not attempt full CP-SAT feasibility.
 */
export function weekCoverage(seed: CanonicalSeed, weekStart: string): CoverageResult {
  const dates = new Set(weekDates(weekStart))
  const weekDemands = seed.demands.filter((d) => dates.has(d.date))

  const required = new Map<string, number>() // `${date}|${role}` → summed count
  for (const d of weekDemands) {
    const key = `${d.date}|${d.requiredRole}`
    required.set(key, (required.get(key) ?? 0) + d.requiredCount)
  }

  const shortfalls: Shortfall[] = []
  for (const [key, req] of [...required.entries()].sort()) {
    const [date, role] = key.split('|') as [string, Role]
    const available = seed.employees.filter(
      (e) => e.qualifications.includes(role) && !onApprovedLeave(seed.leaves, e.id, date),
    ).length
    if (available < req) shortfalls.push({ date, role, required: req, available })
  }
  return { feasible: shortfalls.length === 0, shortfalls }
}

// --- invariants ----------------------------------------------------------------------------------

/**
 * Assert the frozen guarantees the whole subproject rests on. Throws on any violation so a future
 * edit that breaks determinism-relevant shape or the two-week feasibility property fails loudly (the
 * colocated test calls this, and so can the runner before writing).
 */
export function assertCanonicalInvariants(seed: CanonicalSeed): void {
  if (seed.locations.length < 15) {
    throw new Error(`canonical seed: expected ≥15 locations, got ${seed.locations.length}`)
  }
  if (seed.employees.length !== EMPLOYEE_COUNT) {
    throw new Error(`canonical seed: expected ${EMPLOYEE_COUNT} employees, got ${seed.employees.length}`)
  }
  const coordinators = seed.employees.filter((e) => e.qualifications.includes(ROLE.KOORDYNATOR))
  if (coordinators.length !== 3) {
    throw new Error(`canonical seed: KOORDYNATOR must be scarce (exactly 3), got ${coordinators.length}`)
  }
  // Unique ids everywhere (idempotent-upsert keys must not collide).
  for (const [label, ids] of [
    ['unit', seed.units.map((u) => u.id)],
    ['location', seed.locations.map((l) => l.id)],
    ['employee', seed.employees.map((e) => e.id)],
    ['leave', seed.leaves.map((l) => l.id)],
    ['template', seed.templates.map((t) => t.id)],
    ['demand', seed.demands.map((d) => d.id)],
  ] as const) {
    if (new Set(ids).size !== ids.length) throw new Error(`canonical seed: duplicate ${label} id`)
  }
  // Unique PESELs.
  const pesels = seed.employees.map((e) => e.pesel.value)
  if (new Set(pesels).size !== pesels.length) throw new Error('canonical seed: duplicate PESEL')

  // SOFT preferences stay inside their value domains (valid weekday codes + real template starts).
  const validDays = new Set<string>(DOW)
  const validStarts = new Set(templateStartTimes(seed.templates))
  for (const e of seed.employees) {
    if (e.preferredDaysOff.length > 2) {
      throw new Error(`canonical seed: employee ${e.id} has >2 preferredDaysOff`)
    }
    if (new Set(e.preferredDaysOff).size !== e.preferredDaysOff.length) {
      throw new Error(`canonical seed: employee ${e.id} has duplicate preferredDaysOff`)
    }
    for (const d of e.preferredDaysOff) {
      if (!validDays.has(d)) throw new Error(`canonical seed: invalid preferredDaysOff code ${d}`)
    }
    if (e.preferredShiftStart.length > 1) {
      throw new Error(`canonical seed: employee ${e.id} has >1 preferredShiftStart`)
    }
    for (const s of e.preferredShiftStart) {
      if (!validStarts.has(s)) throw new Error(`canonical seed: preferredShiftStart ${s} is not a template start`)
    }
  }

  // The headline property: one feasible week, one infeasible week.
  const feasible = weekCoverage(seed, CANONICAL_WEEKS.feasible.weekStart)
  if (!feasible.feasible) {
    throw new Error(`canonical seed: feasible week is not coverable: ${JSON.stringify(feasible.shortfalls)}`)
  }
  const infeasible = weekCoverage(seed, CANONICAL_WEEKS.infeasible.weekStart)
  if (infeasible.feasible) {
    throw new Error('canonical seed: infeasible week is unexpectedly coverable')
  }
}
