// Mock employee data for the reference app.
//
// In the real app this comes from the authenticated tenant runtime. RODO rule:
// PESEL plaintext NEVER reaches the client — only the last 4 digits — and the
// "reveal" action is logged as an audit_log row. The detail fields here mirror
// what a tenant-scoped `GET /api/employees/:id` would return.

export type EmployeeStatus = 'active' | 'inactive' | 'on-leave' | 'suspended' | 'leave'

export interface Employee {
  id: string
  firstName: string
  lastName: string
  email: string
  position: string
  unit: string
  contract: 'UoP' | 'Zlecenie' | 'B2B'
  /** Last 4 of PESEL only — plaintext PESEL never reaches the client. */
  peselLast4: string
  status: EmployeeStatus
}

export interface AuditEntry {
  /** ISO-ish display timestamp (mono in the UI). */
  ts: string
  action: string
  actor: string
  /** Source IP for sensitive-access events (PESEL reveal). */
  ip?: string
}

export interface EmployeeDetail extends Employee {
  phone: string
  address: string
  /** Birth date is derivable from PESEL, so it stays masked except the year. */
  birthYear: string
  hireDate: string
  contractType: string
  /** e.g. "Pełny etat · 1,0". */
  fte: string
  manager: string
  /** Salary is sensitive; masked in the reference app. */
  salaryMasked: string
  region: string
  realm: string
  /** Most-recent-first audit timeline. */
  audit: AuditEntry[]
}

const REGION = 'EU-CENTRAL'
const REALM = 'hrobot-acme'

function audit(extra: AuditEntry[] = []): AuditEntry[] {
  return [
    ...extra,
    { ts: '2026-04-30 16:18', action: 'Zaktualizowano dane kontaktowe', actor: 'Jan Kowalski' },
    { ts: '2026-03-01 08:00', action: 'Utworzono profil', actor: 'System' },
  ]
}

// Mutable in-memory store (resets on server restart / test module reload)
let EMPLOYEES: EmployeeDetail[] = []

function makeEmployees(): EmployeeDetail[] {
  return [
  {
    id: '1', firstName: 'Anna', lastName: 'Nowak', email: 'anna.nowak@acme.pl',
    position: 'Kierownik zmiany', unit: 'Produkcja', contract: 'UoP', peselLast4: '4821', status: 'active',
    phone: '+48 512 340 221', address: 'Warszawa, 00-844', birthYear: '•• •• 1989',
    hireDate: '2021-03-01', contractType: 'Czas nieokreślony', fte: 'Pełny etat · 1,0',
    manager: 'Jan Kowalski', salaryMasked: '•• ••• PLN', region: REGION, realm: REALM,
    audit: audit([
      { ts: '2026-05-28 14:02', action: 'Ujawniono PESEL', actor: 'Jan Kowalski' },
      { ts: '2026-05-20 09:41', action: 'Zmieniono stanowisko', actor: 'Maria Wójcik' },
    ]),
  },
  {
    id: '2', firstName: 'Piotr', lastName: 'Wiśniewski', email: 'piotr.wisniewski@acme.pl',
    position: 'Operator maszyn', unit: 'Produkcja', contract: 'UoP', peselLast4: '1093', status: 'active',
    phone: '+48 501 220 118', address: 'Pruszków, 05-800', birthYear: '•• •• 1994',
    hireDate: '2022-09-12', contractType: 'Czas określony', fte: 'Pełny etat · 1,0',
    manager: 'Anna Nowak', salaryMasked: '•• ••• PLN', region: REGION, realm: REALM,
    audit: audit([{ ts: '2026-05-11 11:20', action: 'Dodano aneks do umowy', actor: 'Maria Wójcik' }]),
  },
  {
    id: '3', firstName: 'Katarzyna', lastName: 'Wójcik', email: 'k.wojcik@acme.pl',
    position: 'Specjalista HR', unit: 'Kadry', contract: 'UoP', peselLast4: '7754', status: 'active',
    phone: '+48 698 145 309', address: 'Warszawa, 02-512', birthYear: '•• •• 1991',
    hireDate: '2020-01-07', contractType: 'Czas nieokreślony', fte: 'Pełny etat · 1,0',
    manager: 'Jan Kowalski', salaryMasked: '•• ••• PLN', region: REGION, realm: REALM,
    audit: audit([{ ts: '2026-04-02 10:05', action: 'Nadano rolę: HR', actor: 'Jan Kowalski' }]),
  },
  {
    id: '4', firstName: 'Tomasz', lastName: 'Kamiński', email: 't.kaminski@acme.pl',
    position: 'Magazynier', unit: 'Logistyka', contract: 'Zlecenie', peselLast4: '2310', status: 'active',
    phone: '+48 600 781 442', address: 'Piaseczno, 05-500', birthYear: '•• •• 1997',
    hireDate: '2024-06-03', contractType: 'Umowa zlecenie', fte: 'Część etatu · 0,5',
    manager: 'Marek Zieliński', salaryMasked: '•• ••• PLN', region: REGION, realm: REALM,
    audit: audit(),
  },
  {
    id: '5', firstName: 'Magdalena', lastName: 'Lewandowska', email: 'm.lewandowska@acme.pl',
    position: 'Księgowa', unit: 'Finanse', contract: 'UoP', peselLast4: '6642', status: 'leave',
    phone: '+48 723 009 187', address: 'Warszawa, 01-460', birthYear: '•• •• 1986',
    hireDate: '2019-04-15', contractType: 'Czas nieokreślony', fte: 'Pełny etat · 1,0',
    manager: 'Jan Kowalski', salaryMasked: '•• ••• PLN', region: REGION, realm: REALM,
    audit: audit([{ ts: '2026-06-01 08:30', action: 'Rozpoczęto urlop', actor: 'System' }]),
  },
  {
    id: '6', firstName: 'Marek', lastName: 'Zieliński', email: 'm.zielinski@acme.pl',
    position: 'Kierowca', unit: 'Logistyka', contract: 'B2B', peselLast4: '9087', status: 'active',
    phone: '+48 692 558 040', address: 'Grodzisk Maz., 05-825', birthYear: '•• •• 1990',
    hireDate: '2023-02-20', contractType: 'Kontrakt B2B', fte: 'Pełny etat · 1,0',
    manager: 'Jan Kowalski', salaryMasked: '•• ••• PLN', region: REGION, realm: REALM,
    audit: audit(),
  },
  ]
}

EMPLOYEES = makeEmployees()

/** Reset to initial seed data (for test isolation). */
export function resetEmployees(): void {
  EMPLOYEES = makeEmployees()
}

/** List view: returns the full set (table reads only the Employee subset). */
export function getEmployees(): EmployeeDetail[] {
  return EMPLOYEES
}

/** Detail view: returns one employee or undefined (route renders notFound()). */
export function getEmployee(id: string): EmployeeDetail | undefined {
  return EMPLOYEES.find((e) => e.id === id)
}

export const employeeFullName = (e: Pick<Employee, 'firstName' | 'lastName'>) => `${e.firstName} ${e.lastName}`
export const employeeInitials = (e: Pick<Employee, 'firstName' | 'lastName'>) =>
  (e.firstName.charAt(0) + e.lastName.charAt(0)).toUpperCase()

export type EmployeeUpdateFields = Partial<Pick<EmployeeDetail, 'firstName' | 'lastName' | 'position' | 'unit' | 'email' | 'phone'>>

/**
 * Update basic profile fields of an employee.
 * Returns the updated employee or null if not found.
 */
export function updateEmployee(id: string, updates: EmployeeUpdateFields): EmployeeDetail | null {
  const idx = EMPLOYEES.findIndex((e) => e.id === id)
  if (idx === -1) return null
  EMPLOYEES[idx] = { ...EMPLOYEES[idx], ...updates }
  return EMPLOYEES[idx]
}

/**
 * Change the status of an employee.
 * Returns the updated employee or null if not found.
 */
export function setEmployeeStatus(id: string, status: 'active' | 'inactive' | 'on-leave' | 'suspended'): EmployeeDetail | null {
  const idx = EMPLOYEES.findIndex((e) => e.id === id)
  if (idx === -1) return null
  EMPLOYEES[idx] = { ...EMPLOYEES[idx], status }
  return EMPLOYEES[idx]
}

/**
 * Add a new employee to the store.
 * Returns the newly created EmployeeDetail.
 */
export function addEmployee(data: Omit<EmployeeDetail, 'region' | 'realm' | 'audit'>): EmployeeDetail {
  const entry: EmployeeDetail = {
    ...data,
    region: 'EU-CENTRAL',
    realm: 'hrobot-acme',
    audit: [{ ts: new Date().toISOString().slice(0, 16).replace('T', ' '), action: 'Utworzono profil', actor: 'System' }],
  }
  EMPLOYEES.push(entry)
  return entry
}
