import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  formatCostDelta,
  budgetAlertTone,
  budgetAlertText,
  BRAK_STAWKI,
  type BudgetStatusResult,
} from './koszty'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node', so these cover only the pure
// helpers the cost panel + proposal inbox rely on: money formatting, Δcost formatting, and the
// budget-alert tri-state tone/copy. No network.

describe('formatMoney', () => {
  it('formats a PLN decimal string with 2dp + a space before "zł"', () => {
    expect(formatMoney('1234.5', 'PLN')).toBe('1234,50 zł')
    expect(formatMoney('0.00', 'PLN')).toBe('0,00 zł')
  })

  it('formats a plain number the same as its stringified Decimal', () => {
    expect(formatMoney(99.9, 'PLN')).toBe('99,90 zł')
  })

  it('defaults to PLN when currency is omitted', () => {
    expect(formatMoney('10')).toBe('10,00 zł')
  })

  it('suffixes a non-PLN currency with its raw code instead of "zł"', () => {
    expect(formatMoney('10', 'EUR')).toBe('10,00 EUR')
  })

  it('NEVER renders a missing rate as "0 zł" — null/undefined always render "brak stawki"', () => {
    expect(formatMoney(null)).toBe(BRAK_STAWKI)
    expect(formatMoney(undefined)).toBe(BRAK_STAWKI)
    expect(formatMoney(null, 'PLN')).toBe(BRAK_STAWKI)
  })

  it('falls back to "brak stawki" for a non-numeric string rather than throwing or showing NaN', () => {
    expect(formatMoney('not-a-number')).toBe(BRAK_STAWKI)
  })
})

describe('formatCostDelta', () => {
  it('prefixes a positive delta (candidate costlier) with a leading "+"', () => {
    expect(formatCostDelta('45.00')).toBe('+45,00 zł')
  })

  it('keeps the formatted minus sign for a negative delta (a saving) without double-signing', () => {
    expect(formatCostDelta('-12.50')).toBe('-12,50 zł')
  })

  it('renders exactly zero with no sign', () => {
    expect(formatCostDelta('0.00')).toBe('0,00 zł')
  })

  it('NEVER renders a missing-rate Δcost as "+0,00 zł" — null is always "brak stawki"', () => {
    expect(formatCostDelta(null)).toBe(BRAK_STAWKI)
    expect(formatCostDelta(undefined)).toBe(BRAK_STAWKI)
  })

  it('respects a non-PLN currency code', () => {
    expect(formatCostDelta('5', 'EUR')).toBe('+5,00 EUR')
  })
})

describe('budgetAlertTone', () => {
  it('maps overBudget true/false/null to warn/ok/muted', () => {
    expect(budgetAlertTone({ overBudget: true })).toBe('warn')
    expect(budgetAlertTone({ overBudget: false })).toBe('ok')
    expect(budgetAlertTone({ overBudget: null })).toBe('muted')
  })
})

function status(overrides: Partial<BudgetStatusResult> = {}): BudgetStatusResult {
  return {
    cost: '100.00',
    currency: 'PLN',
    missingRates: [],
    currencyConflict: false,
    cap: '500.00',
    overBudget: false,
    ...overrides,
  }
}

describe('budgetAlertText', () => {
  it('reports a currency conflict distinctly, even if overBudget/cap are also set', () => {
    const text = budgetAlertText(status({ currencyConflict: true, cost: null, currency: null, overBudget: null }))
    expect(text).toMatch(/różnych walutach/)
  })

  it('reports "no cap configured" when cap is null, distinct from "within cap"', () => {
    const text = budgetAlertText(status({ cap: null, overBudget: false }))
    expect(text).toMatch(/Brak ustawionego limitu/)
  })

  it('reports over-budget with the cap amount when overBudget is true', () => {
    const text = budgetAlertText(status({ overBudget: true, cap: '500.00', currency: 'PLN' }))
    expect(text).toMatch(/Przekroczono limit/)
    expect(text).toMatch(/500,00 zł/)
  })

  it('reports missing rates distinctly from a clean "within cap" — NEVER asserts OK while a rate is missing', () => {
    const text = budgetAlertText(
      status({ overBudget: null, missingRates: [{ position: 'Kierowca', employmentType: 'B2B', employeeIds: ['e1'] }] }),
    )
    expect(text).toMatch(/nie ma przypisanej stawki/)
  })

  it('reports "within cap" only when the comparison is fully known and clean', () => {
    const text = budgetAlertText(status({ overBudget: false, cap: '500.00', currency: 'PLN', missingRates: [] }))
    expect(text).toMatch(/W ramach limitu/)
    expect(text).toMatch(/500,00 zł/)
  })
})
