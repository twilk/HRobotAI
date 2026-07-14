import { describe, expect, it } from 'vitest'
import {
  buildEmployeeCreate,
  buildEmployeePatch,
  employeeInitials,
  etatLabel,
  formatHiredAt,
  maskPesel,
  mutationErrorMessage,
  profileStatusFromHttpStatus,
  type EmployeeCreateFormState,
  type EmployeeEditFormState,
  type EmployeeProfileData,
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

describe('buildEmployeePatch', () => {
  // The loaded profile the form was seeded from. `baseForm` below is the UNCHANGED form for this
  // profile, so buildEmployeePatch(baseForm, original) must be an empty diff — every field matches.
  const original: EmployeeProfileData = {
    id: 'emp-1',
    firstName: 'Anna',
    lastName: 'Nowak',
    position: 'Kierowca',
    employmentType: 'UMOWA_O_PRACE',
    hiredAt: '2024-03-01T00:00:00.000Z',
    unitId: '0276f4fd-43a2-51eb-b450-c48afe912fd9',
    etat: 1,
    qualifications: ['Prawo jazdy kat. B', 'Obsługa wózka widłowego'],
  }

  const baseForm: EmployeeEditFormState = {
    firstName: 'Anna',
    lastName: 'Nowak',
    position: 'Kierowca',
    employmentType: 'UMOWA_O_PRACE',
    unitId: '0276f4fd-43a2-51eb-b450-c48afe912fd9',
    etat: '1',
    qualifications: 'Prawo jazdy kat. B, Obsługa wózka widłowego',
    pesel: '',
  }

  it('sends {} for an unchanged form (true partial PATCH — never clobbers concurrent edits)', () => {
    expect(buildEmployeePatch(baseForm, original)).toEqual({})
  })

  it('changing ONLY firstName sends only { firstName } (not etat/unitId/etc)', () => {
    const body = buildEmployeePatch({ ...baseForm, firstName: 'Ania' }, original)
    expect(body).toEqual({ firstName: 'Ania' })
  })

  it('omits pesel entirely when the field is blank — a normal edit never sends pesel', () => {
    expect(buildEmployeePatch(baseForm, original)).not.toHaveProperty('pesel')
  })

  it('includes pesel only when the user typed exactly 11 digits (original never has one)', () => {
    const body = buildEmployeePatch({ ...baseForm, pesel: '12345678901' }, original)
    expect(body.pesel).toBe('12345678901')
  })

  it('omits pesel for a partial / invalid (non-11-digit) value rather than sending it', () => {
    expect(buildEmployeePatch({ ...baseForm, pesel: '123' }, original)).not.toHaveProperty('pesel')
    expect(buildEmployeePatch({ ...baseForm, pesel: 'abcdefghijk' }, original)).not.toHaveProperty('pesel')
    expect(buildEmployeePatch({ ...baseForm, pesel: '  ' }, original)).not.toHaveProperty('pesel')
  })

  it('coerces a CHANGED etat from the raw input string to a number', () => {
    const body = buildEmployeePatch({ ...baseForm, etat: '0.5' }, original)
    expect(body.etat).toBe(0.5)
    expect(typeof body.etat).toBe('number')
  })

  it('omits etat when a cleared field (etat: "") would coerce to 0 — not a valid change', () => {
    expect(buildEmployeePatch({ ...baseForm, etat: '' }, original)).not.toHaveProperty('etat')
    expect(buildEmployeePatch({ ...baseForm, etat: 'abc' }, original)).not.toHaveProperty('etat')
  })

  it('includes changed qualifications as a trimmed string array', () => {
    const body = buildEmployeePatch({ ...baseForm, qualifications: 'Prawo jazdy kat. B' }, original)
    expect(body.qualifications).toEqual(['Prawo jazdy kat. B'])
  })

  it('omits qualifications when the array is unchanged (order + elements equal)', () => {
    expect(buildEmployeePatch(baseForm, original)).not.toHaveProperty('qualifications')
  })

  it('detects clearing all qualifications as a change to an empty array', () => {
    const body = buildEmployeePatch({ ...baseForm, qualifications: '' }, original)
    expect(body.qualifications).toEqual([])
  })

  it('trims firstName/lastName before comparing, so whitespace-only edits are not changes', () => {
    expect(buildEmployeePatch({ ...baseForm, firstName: '  Anna  ' }, original)).toEqual({})
  })

  it('includes changed employmentType and unitId, keyed correctly', () => {
    const body = buildEmployeePatch(
      { ...baseForm, employmentType: 'B2B', unitId: '053774f2-63fb-565c-b142-77b17f456ec7' },
      original,
    )
    expect(body).toEqual({
      employmentType: 'B2B',
      unitId: '053774f2-63fb-565c-b142-77b17f456ec7',
    })
  })
})

describe('buildEmployeeCreate', () => {
  // A fully-filled, valid "Dodaj pracownika" form — every other case below mutates ONE field off
  // this baseline so each test isolates exactly the validation rule it's checking.
  const validForm: EmployeeCreateFormState = {
    firstName: 'Anna',
    lastName: 'Nowak',
    position: 'Kierowca',
    employmentType: 'UMOWA_O_PRACE',
    unitId: '0276f4fd-43a2-51eb-b450-c48afe912fd9',
    hiredAt: '2026-07-13',
    etat: '1',
    qualifications: 'Prawo jazdy kat. B, Obsługa wózka widłowego',
    pesel: '12345678901',
  }

  it('builds the full POST body for a valid, fully-filled form', () => {
    expect(buildEmployeeCreate(validForm)).toEqual({
      firstName: 'Anna',
      lastName: 'Nowak',
      position: 'Kierowca',
      employmentType: 'UMOWA_O_PRACE',
      unitId: '0276f4fd-43a2-51eb-b450-c48afe912fd9',
      pesel: '12345678901',
      hiredAt: '2026-07-13',
      etat: 1,
      qualifications: ['Prawo jazdy kat. B', 'Obsługa wózka widłowego'],
    })
  })

  it('trims firstName/lastName/position before sending', () => {
    const body = buildEmployeeCreate({ ...validForm, firstName: '  Anna  ', lastName: ' Nowak ' })
    expect('error' in body).toBe(false)
    if (!('error' in body)) {
      expect(body.firstName).toBe('Anna')
      expect(body.lastName).toBe('Nowak')
    }
  })

  it('errors when firstName is blank/whitespace-only', () => {
    expect(buildEmployeeCreate({ ...validForm, firstName: '' })).toHaveProperty('error')
    expect(buildEmployeeCreate({ ...validForm, firstName: '   ' })).toHaveProperty('error')
  })

  it('errors when lastName is blank', () => {
    expect(buildEmployeeCreate({ ...validForm, lastName: '' })).toHaveProperty('error')
  })

  it('errors when position is blank', () => {
    expect(buildEmployeeCreate({ ...validForm, position: '' })).toHaveProperty('error')
  })

  it('errors when employmentType is not one of the 4 real enum values', () => {
    expect(buildEmployeeCreate({ ...validForm, employmentType: '' })).toHaveProperty('error')
    expect(buildEmployeeCreate({ ...validForm, employmentType: 'NOT_A_TYPE' })).toHaveProperty('error')
  })

  it('errors when unitId is blank (no unit selected)', () => {
    expect(buildEmployeeCreate({ ...validForm, unitId: '' })).toHaveProperty('error')
    expect(buildEmployeeCreate({ ...validForm, unitId: '   ' })).toHaveProperty('error')
  })

  it('errors with the "wymagana" message when hiredAt is blank', () => {
    const body = buildEmployeeCreate({ ...validForm, hiredAt: '' })
    expect(body).toEqual({ error: 'Data zatrudnienia jest wymagana.' })
  })

  it('errors with a distinct "prawidłową datę" message when hiredAt is entered but unparseable', () => {
    const body = buildEmployeeCreate({ ...validForm, hiredAt: 'not-a-date' })
    expect(body).toEqual({ error: 'Podaj prawidłową datę zatrudnienia.' })
  })

  it('errors when pesel is missing entirely', () => {
    expect(buildEmployeeCreate({ ...validForm, pesel: '' })).toHaveProperty('error')
  })

  it('errors when pesel is not exactly 11 digits (too short, too long, non-numeric)', () => {
    expect(buildEmployeeCreate({ ...validForm, pesel: '123' })).toHaveProperty('error')
    expect(buildEmployeeCreate({ ...validForm, pesel: '123456789012' })).toHaveProperty('error')
    expect(buildEmployeeCreate({ ...validForm, pesel: 'abcdefghijk' })).toHaveProperty('error')
  })

  it('errors when etat is provided but out of the 0..1 range', () => {
    expect(buildEmployeeCreate({ ...validForm, etat: '1.5' })).toHaveProperty('error')
    expect(buildEmployeeCreate({ ...validForm, etat: '-0.1' })).toHaveProperty('error')
  })

  it('errors when etat is provided but not a finite number', () => {
    expect(buildEmployeeCreate({ ...validForm, etat: 'abc' })).toHaveProperty('error')
  })

  it('omits etat entirely when the field is left blank — the backend default applies', () => {
    const body = buildEmployeeCreate({ ...validForm, etat: '' })
    expect('error' in body).toBe(false)
    expect(body).not.toHaveProperty('etat')
  })

  it('splits qualifications on commas and trims each entry', () => {
    const body = buildEmployeeCreate({ ...validForm, qualifications: ' Prawo jazdy kat. B ,  Spawanie ' })
    expect('error' in body).toBe(false)
    if (!('error' in body)) {
      expect(body.qualifications).toEqual(['Prawo jazdy kat. B', 'Spawanie'])
    }
  })

  it('omits qualifications entirely when the field is blank — no pointless empty array', () => {
    const body = buildEmployeeCreate({ ...validForm, qualifications: '' })
    expect('error' in body).toBe(false)
    expect(body).not.toHaveProperty('qualifications')
  })
})

describe('mutationErrorMessage', () => {
  it('maps 403 to the shared "Brak uprawnień." message regardless of caller', () => {
    expect(mutationErrorMessage(403)).toBe('Brak uprawnień.')
    expect(mutationErrorMessage(403, { badRequest: 'x' })).toBe('Brak uprawnień.')
  })

  it('maps 409 to the shared PESEL-conflict message', () => {
    expect(mutationErrorMessage(409)).toBe('Pracownik z tym numerem PESEL już istnieje.')
  })

  it('uses the caller-supplied 400 wording (each form phrases its own bad-request hint)', () => {
    expect(mutationErrorMessage(400, { badRequest: 'Nieprawidłowe dane, sprawdź PESEL/etat.' })).toBe(
      'Nieprawidłowe dane, sprawdź PESEL/etat.',
    )
    expect(
      mutationErrorMessage(400, { badRequest: 'Nieprawidłowe dane — sprawdź PESEL, etat i wymagane pola.' }),
    ).toBe('Nieprawidłowe dane — sprawdź PESEL, etat i wymagane pola.')
  })

  it('falls back to a generic 400 message when no badRequest wording is supplied', () => {
    expect(mutationErrorMessage(400)).toBe('Nieprawidłowe dane. Sprawdź formularz i spróbuj ponownie.')
  })

  it('folds any other status (500, 502, unexpected 2xx) into the generic retry message', () => {
    expect(mutationErrorMessage(500)).toBe('Coś poszło nie tak. Spróbuj ponownie.')
    expect(mutationErrorMessage(502)).toBe('Coś poszło nie tak. Spróbuj ponownie.')
  })
})
