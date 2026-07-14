import { describe, expect, it } from 'vitest'
import {
  accessTypeLabel,
  accessStatusLabel,
  canRevoke,
  humanizeAccessError,
  buildIssueBody,
  ACCESS_TYPES,
  ACCESS_STATUSES,
  EMPTY_ISSUE_FORM,
  type AccessType,
  type AccessStatus,
  type IssueFormState,
} from './dostepy'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — these cover only the pure
// helpers the Dostępy screen relies on: label maps, the revoke-eligibility gate, the 409 message
// translation, and the issue-form validator/builder. No network, no PII.

describe('accessTypeLabel', () => {
  it('maps every access type to a distinct Polish label', () => {
    expect(accessTypeLabel('CARD')).toBe('Karta dostępu')
    expect(accessTypeLabel('KEY')).toBe('Klucz')
    expect(accessTypeLabel('PERMISSION')).toBe('Uprawnienie')
  })

  it('covers all three enum values with unique labels', () => {
    const labels = ACCESS_TYPES.map(accessTypeLabel)
    expect(ACCESS_TYPES).toHaveLength(3)
    expect(new Set(labels).size).toBe(3)
  })

  it('echoes an unknown value back rather than throwing', () => {
    expect(accessTypeLabel('SOMETHING_UNKNOWN' as AccessType)).toBe('SOMETHING_UNKNOWN')
  })
})

describe('accessStatusLabel', () => {
  it('maps every access status to a distinct Polish label', () => {
    expect(accessStatusLabel('ACTIVE')).toBe('Aktywny')
    expect(accessStatusLabel('REVOKED')).toBe('Odwołany')
    expect(accessStatusLabel('LOST')).toBe('Zgubiony')
  })

  it('covers all three enum values with unique labels', () => {
    const labels = ACCESS_STATUSES.map(accessStatusLabel)
    expect(ACCESS_STATUSES).toHaveLength(3)
    expect(new Set(labels).size).toBe(3)
  })

  it('echoes an unknown value back rather than throwing', () => {
    expect(accessStatusLabel('SOMETHING_UNKNOWN' as AccessStatus)).toBe('SOMETHING_UNKNOWN')
  })
})

describe('canRevoke', () => {
  it('is true only for ACTIVE', () => {
    expect(canRevoke('ACTIVE')).toBe(true)
    expect(canRevoke('REVOKED')).toBe(false)
    expect(canRevoke('LOST')).toBe(false)
  })
})

describe('humanizeAccessError', () => {
  it('translates the revoke "not active" 409 to Polish', () => {
    expect(humanizeAccessError(409, 'Access grant is not active')).toBe(
      'Ten dostęp został już odwołany lub zgłoszony jako zgubiony.',
    )
  })

  it('translates the revoke "changed concurrently" 409 to Polish', () => {
    expect(humanizeAccessError(409, 'Access grant changed concurrently')).toBe(
      'Dostęp zmienił się w międzyczasie. Odśwież listę i spróbuj ponownie.',
    )
  })

  it('passes through an already-Polish 409 (e.g. issue duplicate-identifier) unchanged', () => {
    const msg = 'Aktywna karta/klucz o tym identyfikatorze już istnieje'
    expect(humanizeAccessError(409, msg)).toBe(msg)
  })

  it('passes through non-409 messages unchanged', () => {
    expect(humanizeAccessError(403, 'Access grant is outside your scope')).toBe(
      'Access grant is outside your scope',
    )
    expect(humanizeAccessError(404, 'Access grant xyz not found')).toBe('Access grant xyz not found')
  })
})

describe('buildIssueBody', () => {
  function form(overrides: Partial<IssueFormState> = {}): IssueFormState {
    return { ...EMPTY_ISSUE_FORM, employeeId: 'emp-1', type: 'CARD', label: 'Karta biurowa', ...overrides }
  }

  it('builds the minimal required body (employeeId/type/label only)', () => {
    expect(buildIssueBody(form())).toEqual({ employeeId: 'emp-1', type: 'CARD', label: 'Karta biurowa' })
  })

  it('trims and includes optional fields only when non-empty', () => {
    expect(
      buildIssueBody(
        form({
          identifier: '  KART-001  ',
          lokalizacjaId: '  ',
          notes: '  zapasowa  ',
        }),
      ),
    ).toEqual({
      employeeId: 'emp-1',
      type: 'CARD',
      label: 'Karta biurowa',
      identifier: 'KART-001',
      notes: 'zapasowa',
    })
  })

  it('includes a well-formed lokalizacjaId UUID', () => {
    const result = buildIssueBody(form({ lokalizacjaId: '11111111-2222-3333-4444-555555555555' }))
    expect(result).toEqual({
      employeeId: 'emp-1',
      type: 'CARD',
      label: 'Karta biurowa',
      lokalizacjaId: '11111111-2222-3333-4444-555555555555',
    })
  })

  it('rejects a malformed lokalizacjaId', () => {
    expect(buildIssueBody(form({ lokalizacjaId: 'not-a-uuid' }))).toEqual({
      error: 'Nieprawidłowy identyfikator lokalizacji (oczekiwano UUID).',
    })
  })

  it('requires an employee selection', () => {
    expect(buildIssueBody(form({ employeeId: '  ' }))).toEqual({ error: 'Wybierz pracownika.' })
  })

  it('requires a non-empty label', () => {
    expect(buildIssueBody(form({ label: '   ' }))).toEqual({
      error: 'Podaj etykietę (np. rodzaj karty/klucza).',
    })
  })

  it('rejects an invalid type', () => {
    expect(buildIssueBody(form({ type: 'BADGE' as AccessType }))).toEqual({ error: 'Wybierz rodzaj dostępu.' })
  })
})
