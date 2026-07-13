// Pure helpers for the single-employee profile screen (components/employees/employee-profile.tsx).
// Split out from the component so the masking/status logic can be unit-tested without a DOM/render
// harness — this repo's vitest config only runs `lib/**/*.test.ts` under a `node` environment (no
// jsdom / @testing-library/react installed), see vitest.config.ts.

import { MONTHS_PL } from './grafik'

/**
 * Raw shape from tenant-runtime `GET /api/employees/:id` (RODO: full PESEL / home address are NEVER
 * returned — see apps/tenant-runtime/src/employees/employees.service.ts#getById). `peselLast4` is
 * present ONLY when the acting session is HR/ADMIN_KLIENTA (a "global" actor); everyone else, and any
 * decrypt failure, gets no PESEL hint at all.
 */
export interface EmployeeProfileData {
  id: string
  firstName: string
  lastName: string
  position: string
  employmentType: string
  hiredAt: string
  unitId: string
  /** Contract fraction (1.0 = full-time). Prisma Decimal serializes as string or number over JSON. */
  etat: number | string
  qualifications: string[]
  peselLast4?: string
}

/** Screen state derived from the `/api/employees/:id` response's HTTP status. */
export type ProfileStatus = 'forbidden' | 'not-found' | 'error' | 'ok'

/**
 * Map an HTTP status from the proxy to the screen state to render. 403 = out-of-scope employee
 * (MANAGER/PRACOWNIK reading someone outside their unit), 404 = unknown id, 400 = malformed
 * (non-UUID) id — folded into 'error' alongside 5xx/network failures since there's nothing
 * profile-specific to show for either. 2xx = 'ok'.
 */
export function profileStatusFromHttpStatus(status: number): ProfileStatus {
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status >= 200 && status < 300) return 'ok'
  return 'error'
}

/**
 * RODO: only ever show the last 4 digits, masked — mirrors EmployeesTable's PESEL cell exactly.
 * Returns undefined when the backend omitted `peselLast4` (a non-HR/ADMIN actor, or a decrypt
 * failure) so the caller renders NO PESEL row at all, rather than a misleading placeholder.
 */
export function maskPesel(peselLast4: string | undefined): string | undefined {
  return peselLast4 ? `•••••••${peselLast4}` : undefined
}

/** Contract fraction → Polish label, e.g. 1 → "1 etatu", 0.5 → "0,5 etatu" (comma decimal, mirrors
 *  lib/grafik.ts's formatHours convention). */
export function etatLabel(etat: number | string): string {
  const rounded = Math.round(Number(etat) * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
  return `${text} etatu`
}

/** Polish-formatted hire date, e.g. "2024-03-01T00:00:00.000Z" → "1 marca 2024". Falls back to the
 *  raw string on a malformed/unparsable date rather than throwing. */
export function formatHiredAt(hiredAt: string): string {
  const d = new Date(hiredAt)
  if (Number.isNaN(d.getTime())) return hiredAt
  return `${d.getUTCDate()} ${MONTHS_PL[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Two-letter avatar initials from first+last name ("Anna Nowak" → "AN"). Shared by the roster table
 *  and the profile card so the avatar tile matches in both places. */
export function employeeInitials(e: { firstName: string; lastName: string }): string {
  return (e.firstName.charAt(0) + e.lastName.charAt(0)).toUpperCase()
}

/**
 * Controlled-input state for the HR/ADMIN edit form (components/employees/employee-edit-form.tsx).
 * All fields are strings (raw input values) — `etat` and `qualifications` need coercion before they
 * match the backend `UpdateEmployeeDto` shape, done by `buildEmployeePatch` below. `pesel` is ALWAYS
 * initialised blank (never prefilled from the loaded profile — the backend never returns it either),
 * and stays blank unless the HR/ADMIN user deliberately types a new one.
 */
export interface EmployeeEditFormState {
  firstName: string
  lastName: string
  position: string
  employmentType: string
  unitId: string
  /** Raw text-input value for the etat number field (e.g. "1", "0.5", "" while clearing). */
  etat: string
  /** Comma-separated qualifications, e.g. "Prawo jazdy kat. B, Obsługa wózka widłowego". */
  qualifications: string
  /** Blank unless the user typed a replacement PESEL; never prefilled. */
  pesel: string
}

/**
 * Body sent to `PATCH /api/employees/:id` — a TRUE partial of the backend's `UpdateEmployeeDto`.
 * Every key is optional because `buildEmployeePatch` emits ONLY the fields that actually changed
 * from the loaded profile (the backend writes only the keys present, so re-sending unchanged fields
 * would clobber a concurrent edit by another HR user — see buildEmployeePatch).
 */
export interface EmployeePatchBody {
  firstName?: string
  lastName?: string
  position?: string
  employmentType?: string
  unitId?: string
  etat?: number
  qualifications?: string[]
  pesel?: string
}

const PESEL_RE = /^\d{11}$/

/** Parse the raw etat input to a finite number, or null when blank/NaN (a cleared field). */
function parseEtat(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/** True when two qualification arrays differ (length, or any element by position). */
function qualificationsDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true
  return a.some((q, i) => q !== b[i])
}

/**
 * Pure builder for the PATCH body — a DIFF against the loaded `original` profile. The backend
 * `UpdateEmployeeDto` is a true partial (only present keys are written), so emitting only genuinely
 * changed fields avoids clobbering a field another HR user changed between page-load and save.
 * - firstName/lastName/position: trimmed, included only when the trimmed value !== original;
 * - employmentType/unitId: included only when !== original;
 * - etat: coerced to a number; included only when it parses to a finite number AND differs from the
 *   original (a cleared/NaN etat is NOT a valid change — omitted, belt-and-suspenders with the
 *   form's client-side validation);
 * - qualifications: split from the comma-separated field; included only when the array differs;
 * - pesel: write-only/RODO — the original never carries a pesel, so a valid new pesel is always a
 *   change; included ONLY when the field is exactly 11 digits, omitted otherwise (blank, partial,
 *   non-digits) so a routine edit never sends/overwrites PESEL.
 */
export function buildEmployeePatch(
  form: EmployeeEditFormState,
  original: EmployeeProfileData,
): EmployeePatchBody {
  const body: EmployeePatchBody = {}

  const firstName = form.firstName.trim()
  if (firstName !== original.firstName) body.firstName = firstName

  const lastName = form.lastName.trim()
  if (lastName !== original.lastName) body.lastName = lastName

  const position = form.position.trim()
  if (position !== original.position) body.position = position

  if (form.employmentType !== original.employmentType) body.employmentType = form.employmentType

  if (form.unitId !== original.unitId) body.unitId = form.unitId

  const etat = parseEtat(form.etat)
  if (etat !== null && etat !== Number(original.etat)) body.etat = etat

  const qualifications = form.qualifications
    .split(',')
    .map((q) => q.trim())
    .filter(Boolean)
  if (qualificationsDiffer(qualifications, original.qualifications)) body.qualifications = qualifications

  const pesel = form.pesel.trim()
  if (PESEL_RE.test(pesel)) body.pesel = pesel

  return body
}
