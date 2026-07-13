import { describe, expect, it } from 'vitest'
import {
  employeeInitials,
  etatLabel,
  formatHiredAt,
  maskPesel,
  profileStatusFromHttpStatus,
} from './employee-profile'

// This repo has no jsdom/@testing-library/react harness (vitest.config.ts runs `lib/**/*.test.ts`
// under environment: 'node' only), so component rendering isn't unit-tested anywhere in this repo.
// These cases cover the exact pure logic that decides what the EmployeeProfile component renders for
// each backend response: whether the PESEL row appears at all, and which of the loading / forbidden /
// not-found / error / ok states is shown — the RODO-sensitive and RBAC-sensitive parts of Task 2b.

describe('maskPesel', () => {
  it('masks a present peselLast4 as 7 bullets + the 4 digits', () => {
    expect(maskPesel('1359')).toBe('•••••••1359')
  })

  it('returns undefined when peselLast4 is absent (non-HR/ADMIN actor, or a decrypt failure) — no PESEL row', () => {
    expect(maskPesel(undefined)).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(maskPesel('')).toBeUndefined()
  })
})

describe('profileStatusFromHttpStatus', () => {
  it('maps 403 to forbidden (out-of-scope employee)', () => {
    expect(profileStatusFromHttpStatus(403)).toBe('forbidden')
  })

  it('maps 404 to not-found (unknown id)', () => {
    expect(profileStatusFromHttpStatus(404)).toBe('not-found')
  })

  it('maps any 2xx to ok', () => {
    expect(profileStatusFromHttpStatus(200)).toBe('ok')
    expect(profileStatusFromHttpStatus(201)).toBe('ok')
  })

  it('folds 400 (non-UUID id), 401, and 5xx into error', () => {
    expect(profileStatusFromHttpStatus(400)).toBe('error')
    expect(profileStatusFromHttpStatus(401)).toBe('error')
    expect(profileStatusFromHttpStatus(500)).toBe('error')
    expect(profileStatusFromHttpStatus(502)).toBe('error')
  })
})

describe('etatLabel', () => {
  it('renders a whole-number etat with no decimal', () => {
    expect(etatLabel(1)).toBe('1 etatu')
  })

  it('renders a fractional etat with a Polish comma', () => {
    expect(etatLabel(0.5)).toBe('0,5 etatu')
    expect(etatLabel(0.75)).toBe('0,75 etatu')
  })

  it('accepts a string (Prisma Decimal may serialize as a string over JSON)', () => {
    expect(etatLabel('1.0')).toBe('1 etatu')
    expect(etatLabel('0.5')).toBe('0,5 etatu')
  })
})

describe('employeeInitials', () => {
  it('builds two-letter initials from first + last name', () => {
    expect(employeeInitials({ firstName: 'Anna', lastName: 'Nowak' })).toBe('AN')
  })

  it('uppercases lowercase names', () => {
    expect(employeeInitials({ firstName: 'jan', lastName: 'kowalski' })).toBe('JK')
  })
})

describe('formatHiredAt', () => {
  it('formats an ISO datetime to a Polish "D month YYYY" string', () => {
    expect(formatHiredAt('2024-03-01T00:00:00.000Z')).toBe('1 marca 2024')
  })

  it('formats a bare ISO date the same way', () => {
    expect(formatHiredAt('2026-07-13')).toBe('13 lipca 2026')
  })

  it('falls back to the raw string when unparsable, rather than throwing', () => {
    expect(formatHiredAt('not-a-date')).toBe('not-a-date')
  })
})
