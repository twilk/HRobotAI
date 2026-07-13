import { describe, expect, it } from 'vitest'
import { autonomyLabel, validateQuietHours, AUTONOMY_LEVELS } from './ai-grafik'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node', so these cover only the pure
// helpers the AI-config panel relies on: the Polish autonomy labels and the quiet-hours validation
// that gates the PATCH. No PII, no network — pure functions.

describe('autonomyLabel', () => {
  it('maps every autonomy level to a distinct Polish label', () => {
    expect(autonomyLabel('SUGGEST_ONLY')).toBe('Tylko sugestie')
    expect(autonomyLabel('AUTO_NOTIFY')).toBe('Automatycznie z powiadomieniem')
    expect(autonomyLabel('AUTO_ASK_CONSENT')).toBe('Automatycznie za zgodą pracownika')
    expect(autonomyLabel('AUTO_COMMIT_ON_APPROVAL')).toBe('Automatycznie po zatwierdzeniu')
  })

  it('covers all four enum values with unique labels', () => {
    const labels = AUTONOMY_LEVELS.map(autonomyLabel)
    expect(AUTONOMY_LEVELS).toHaveLength(4)
    expect(new Set(labels).size).toBe(4)
  })
})

describe('validateQuietHours', () => {
  it('accepts both-empty (feature off), tolerating whitespace', () => {
    expect(validateQuietHours('', '')).toBe(true)
    expect(validateQuietHours('  ', ' ')).toBe(true)
  })

  it('accepts a well-formed HH:mm window on both bounds', () => {
    expect(validateQuietHours('22:00', '06:00')).toBe(true)
    expect(validateQuietHours('00:00', '23:59')).toBe(true)
    expect(validateQuietHours(' 08:30 ', ' 17:45 ')).toBe(true)
  })

  it('rejects a one-sided window', () => {
    expect(validateQuietHours('22:00', '')).toBe(false)
    expect(validateQuietHours('', '06:00')).toBe(false)
  })

  it('rejects malformed times', () => {
    expect(validateQuietHours('24:00', '06:00')).toBe(false)
    expect(validateQuietHours('9:00', '17:00')).toBe(false)
    expect(validateQuietHours('22:60', '06:00')).toBe(false)
    expect(validateQuietHours('abc', 'def')).toBe(false)
  })
})
