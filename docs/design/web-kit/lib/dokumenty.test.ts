import { describe, expect, it } from 'vitest'
import {
  documentTypeLabel,
  documentFormatLabel,
  documentStatusLabel,
  scopeLabel,
  formatDate,
  formatPeriodRange,
  formatMinutes,
  overtimeTotals,
  formatOvertimeSummary,
  formatWorkedTotal,
  isApprovable,
  DOCUMENT_TYPES,
  DOCUMENT_FORMATS,
  DOC_SCOPE_TYPES,
  type DocumentType,
  type DocumentFormat,
  type DocumentStatus,
  type DocScopeType,
  type DocumentComputedFacts,
} from './dokumenty'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — these cover only the pure
// formatting calculators the dokumenty screen (app/(tenant)/dokumenty) renders. No network, no PII.

function facts(employees: DocumentComputedFacts['employees']): DocumentComputedFacts {
  return {
    type: 'NADGODZINY',
    scopeType: 'ALL',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    algorithmVersion: 1,
    employees,
  }
}

describe('documentTypeLabel', () => {
  it('maps every DocumentType to a distinct Polish label', () => {
    expect(documentTypeLabel('EWIDENCJA_CZASU_PRACY')).toBe('Ewidencja czasu pracy')
    expect(documentTypeLabel('NADGODZINY')).toBe('Nadgodziny')
    expect(documentTypeLabel('ZUS_KEDU')).toBe('Eksport ZUS/Płatnik (KEDU)')
  })

  it('covers all three type values with unique labels', () => {
    const labels = DOCUMENT_TYPES.map(documentTypeLabel)
    expect(new Set(labels).size).toBe(3)
  })

  it('echoes an unknown value rather than throwing', () => {
    expect(documentTypeLabel('WHATEVER' as DocumentType)).toBe('WHATEVER')
  })
})

describe('documentFormatLabel', () => {
  it('maps every DocumentFormat to a distinct Polish label', () => {
    expect(documentFormatLabel('PDF')).toBe('PDF')
    expect(documentFormatLabel('XML_KEDU')).toBe('XML (KEDU)')
  })

  it('covers both format values with unique labels', () => {
    const labels = DOCUMENT_FORMATS.map(documentFormatLabel)
    expect(new Set(labels).size).toBe(2)
  })
})

describe('documentStatusLabel', () => {
  it('maps GENERATED to the "do zatwierdzenia" warn tone', () => {
    expect(documentStatusLabel('GENERATED')).toEqual({ label: 'Do zatwierdzenia', tone: 'warn' })
  })

  it('maps APPROVED to the ok tone', () => {
    expect(documentStatusLabel('APPROVED')).toEqual({ label: 'Zatwierdzony', tone: 'ok' })
  })

  it('maps SUPERSEDED to the muted tone', () => {
    expect(documentStatusLabel('SUPERSEDED')).toEqual({ label: 'Zastąpiony', tone: 'muted' })
  })

  it('covers all three status values with unique labels', () => {
    const statuses: DocumentStatus[] = ['GENERATED', 'APPROVED', 'SUPERSEDED']
    const labels = statuses.map((s) => documentStatusLabel(s).label)
    expect(new Set(labels).size).toBe(3)
  })
})

describe('scopeLabel', () => {
  it('maps every DocScopeType to a distinct Polish label', () => {
    expect(scopeLabel('EMPLOYEE')).toBe('Pracownik')
    expect(scopeLabel('UNIT')).toBe('Jednostka')
    expect(scopeLabel('ALL')).toBe('Cała firma')
  })

  it('covers all three scope values with unique labels', () => {
    const labels = DOC_SCOPE_TYPES.map(scopeLabel)
    expect(new Set(labels).size).toBe(3)
  })

  it('echoes an unknown value rather than throwing', () => {
    expect(scopeLabel('X' as DocScopeType)).toBe('X')
  })
})

describe('formatDate', () => {
  it('formats a bare YYYY-MM-DD as dd.mm.yyyy', () => {
    expect(formatDate('2026-07-01')).toBe('01.07.2026')
  })

  it('formats a full ISO timestamp (a @db.Date column round-tripped over JSON) the same way', () => {
    expect(formatDate('2026-07-31T00:00:00.000Z')).toBe('31.07.2026')
  })

  it('falls back to the raw slice on a malformed date rather than throwing', () => {
    expect(formatDate('bad')).toBe('bad')
  })
})

describe('formatPeriodRange', () => {
  it('renders both bounds with an en dash', () => {
    expect(formatPeriodRange('2026-07-01', '2026-07-31')).toBe('01.07.2026 – 31.07.2026')
  })
})

describe('formatMinutes', () => {
  it('null (RCP null-policy: "brak danych" ≠ "0 godzin") → em dash', () => {
    expect(formatMinutes(null)).toBe('—')
  })

  it('formats a value with both hours and minutes', () => {
    expect(formatMinutes(510)).toBe('8h 30m')
  })

  it('formats an exact number of hours with a zero minutes remainder', () => {
    expect(formatMinutes(480)).toBe('8h 0m')
  })

  it('formats a sub-hour value', () => {
    expect(formatMinutes(45)).toBe('0h 45m')
  })

  it('formats zero distinctly from null', () => {
    expect(formatMinutes(0)).toBe('0h 0m')
  })

  it('rounds a fractional minute count', () => {
    expect(formatMinutes(90.6)).toBe('1h 31m')
  })

  it('renders a negative value with a leading sign rather than flipping it', () => {
    expect(formatMinutes(-30)).toBe('-0h 30m')
  })
})

describe('overtimeTotals', () => {
  it('sums ot50/ot100(+night/Sunday/holiday)/daysWithoutRcp across every employee', () => {
    const f = facts([
      { employeeId: 'e1', workedMinutes: 9600, ot50Min: 60, ot100Min: 30, ot100NightSundayHolidayMin: 20, daysWithoutRcp: 1 },
      { employeeId: 'e2', workedMinutes: 9000, ot50Min: 0, ot100Min: 0, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 0 },
    ])
    expect(overtimeTotals(f)).toEqual({ ot50Min: 60, ot100Min: 50, totalMin: 110, daysWithoutRcp: 1 })
  })

  it('an empty employees array totals to all zeros', () => {
    expect(overtimeTotals(facts([]))).toEqual({ ot50Min: 0, ot100Min: 0, totalMin: 0, daysWithoutRcp: 0 })
  })
})

describe('formatOvertimeSummary', () => {
  it('"Brak nadgodzin" when every bucket is zero and no missing-data days', () => {
    const f = facts([{ employeeId: 'e1', workedMinutes: 9600, ot50Min: 0, ot100Min: 0, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 0 }])
    expect(formatOvertimeSummary(f)).toBe('Brak nadgodzin')
  })

  it('reports the total plus a 50% and 100% breakdown when both are present', () => {
    const f = facts([{ employeeId: 'e1', workedMinutes: 9600, ot50Min: 240, ot100Min: 120, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 0 }])
    expect(formatOvertimeSummary(f)).toBe('łącznie 6h 0m · 50%: 4h 0m · 100%: 2h 0m')
  })

  it('omits a zero bucket from the breakdown (50%-only overtime)', () => {
    const f = facts([{ employeeId: 'e1', workedMinutes: 9600, ot50Min: 60, ot100Min: 0, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 0 }])
    expect(formatOvertimeSummary(f)).toBe('łącznie 1h 0m · 50%: 1h 0m')
  })

  it('appends the "brak danych RCP" caveat even when nadgodziny are otherwise zero', () => {
    const f = facts([{ employeeId: 'e1', workedMinutes: 0, ot50Min: 0, ot100Min: 0, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 2 }])
    expect(formatOvertimeSummary(f)).toBe('Brak nadgodzin · brak danych RCP: 2 dni')
  })

  it('combines the breakdown with the caveat when both apply', () => {
    const f = facts([{ employeeId: 'e1', workedMinutes: 9600, ot50Min: 60, ot100Min: 0, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 1 }])
    expect(formatOvertimeSummary(f)).toBe('łącznie 1h 0m · 50%: 1h 0m · brak danych RCP: 1 dni')
  })
})

describe('formatWorkedTotal', () => {
  it('sums workedMinutes across every employee and formats via formatMinutes', () => {
    const f = facts([
      { employeeId: 'e1', workedMinutes: 9600, ot50Min: 0, ot100Min: 0, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 0 },
      { employeeId: 'e2', workedMinutes: 30, ot50Min: 0, ot100Min: 0, ot100NightSundayHolidayMin: 0, daysWithoutRcp: 0 },
    ])
    expect(formatWorkedTotal(f)).toBe('160h 30m')
  })

  it('an empty employees array totals to zero, not null', () => {
    expect(formatWorkedTotal(facts([]))).toBe('0h 0m')
  })
})

describe('isApprovable', () => {
  it('NADGODZINY and ZUS_KEDU are approvable', () => {
    expect(isApprovable('NADGODZINY')).toBe(true)
    expect(isApprovable('ZUS_KEDU')).toBe(true)
  })

  it('EWIDENCJA_CZASU_PRACY is final on generate — not approvable', () => {
    expect(isApprovable('EWIDENCJA_CZASU_PRACY')).toBe(false)
  })
})
