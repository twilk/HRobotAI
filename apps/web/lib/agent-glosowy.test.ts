import { describe, expect, it } from 'vitest'
import {
  intentLabel,
  confidenceTone,
  formatConfidence,
  shouldShowConfirm,
  canAutoExecute,
  fallbackLink,
  FALLBACK_MESSAGE,
  CONFIDENCE_THRESHOLD,
  type AgentIntent,
} from './agent-glosowy'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — these cover only the pure
// formatting/decision calculators the asystent screen (app/(tenant)/asystent) renders. No network.

describe('intentLabel', () => {
  it('maps every AgentIntent to a distinct Polish label', () => {
    expect(intentLabel('URLOP')).toBe('Wniosek urlopowy')
    expect(intentLabel('L4')).toBe('Zwolnienie lekarskie (L4)')
    expect(intentLabel('MOJ_GRAFIK')).toBe('Mój grafik')
    expect(intentLabel('NIEZNANE')).toBe('Nierozpoznane polecenie')
  })

  it('covers all four intents with unique labels', () => {
    const intents: AgentIntent[] = ['URLOP', 'L4', 'MOJ_GRAFIK', 'NIEZNANE']
    const labels = intents.map(intentLabel)
    expect(new Set(labels).size).toBe(4)
  })

  it('echoes an unknown value rather than throwing', () => {
    expect(intentLabel('WHATEVER' as AgentIntent)).toBe('WHATEVER')
  })
})

describe('confidenceTone', () => {
  it('returns ok at/above CONFIDENCE_THRESHOLD (the backend HIGH_CONFIDENCE case, 0.9)', () => {
    expect(confidenceTone(0.9)).toBe('ok')
    expect(confidenceTone(CONFIDENCE_THRESHOLD)).toBe('ok')
  })

  it('returns warn for a recognized-but-uncertain parse below threshold (the backend LOW_CONFIDENCE case, 0.5)', () => {
    expect(confidenceTone(0.5)).toBe('warn')
  })

  it('returns muted for zero confidence (NIEZNANE)', () => {
    expect(confidenceTone(0)).toBe('muted')
  })
})

describe('formatConfidence', () => {
  it('renders a 0..1 confidence as a rounded whole percent', () => {
    expect(formatConfidence(0.9)).toBe('90%')
    expect(formatConfidence(0.5)).toBe('50%')
    expect(formatConfidence(0)).toBe('0%')
  })

  it('rounds to the nearest whole percent rather than truncating', () => {
    expect(formatConfidence(0.876)).toBe('88%')
  })
})

describe('shouldShowConfirm', () => {
  it('shows the confirm button for a write intent needing confirmation (URLOP/L4 with a parsed date)', () => {
    expect(shouldShowConfirm({ requiresConfirmation: true, fallbackToForm: false })).toBe(true)
  })

  it('hides the confirm button for a read intent (MOJ_GRAFIK)', () => {
    expect(shouldShowConfirm({ requiresConfirmation: false, fallbackToForm: false })).toBe(false)
  })

  it('hides the confirm button for a fallback result even if requiresConfirmation were somehow true', () => {
    expect(shouldShowConfirm({ requiresConfirmation: true, fallbackToForm: true })).toBe(false)
  })
})

describe('canAutoExecute', () => {
  it('allows auto-execute for a recognized read (MOJ_GRAFIK)', () => {
    expect(canAutoExecute({ requiresConfirmation: false, fallbackToForm: false })).toBe(true)
  })

  it('disallows auto-execute for a write intent (needs the confirm click)', () => {
    expect(canAutoExecute({ requiresConfirmation: true, fallbackToForm: false })).toBe(false)
  })

  it('disallows auto-execute for a fallback result', () => {
    expect(canAutoExecute({ requiresConfirmation: false, fallbackToForm: true })).toBe(false)
  })
})

describe('fallbackLink', () => {
  it('points a URLOP/L4 fallback at the wnioski form', () => {
    expect(fallbackLink('URLOP')).toEqual({ label: 'Przejdź do formularza wniosków', href: '/wnioski' })
    expect(fallbackLink('L4')).toEqual({ label: 'Przejdź do formularza wniosków', href: '/wnioski' })
  })

  it('points a MOJ_GRAFIK fallback at the grafik screen', () => {
    expect(fallbackLink('MOJ_GRAFIK')).toEqual({ label: 'Przejdź do grafiku', href: '/grafik' })
  })

  it('falls back to the wnioski link for NIEZNANE or an unrecognized value', () => {
    expect(fallbackLink('NIEZNANE')).toEqual({ label: 'Przejdź do formularza wniosków', href: '/wnioski' })
    expect(fallbackLink('SOMETHING_ELSE' as AgentIntent)).toEqual({
      label: 'Przejdź do formularza wniosków',
      href: '/wnioski',
    })
  })
})

describe('FALLBACK_MESSAGE', () => {
  it('is the fixed SPEC-mandated Polish copy', () => {
    expect(FALLBACK_MESSAGE).toBe('Nie zrozumiałem — użyj formularza.')
  })
})
