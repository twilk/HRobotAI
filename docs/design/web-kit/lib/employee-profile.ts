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
