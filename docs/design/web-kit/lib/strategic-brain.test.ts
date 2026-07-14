import { describe, expect, it } from 'vitest'
import {
  retentionLabel,
  slopeIndicator,
  verdictLabel,
  confidenceDisclosure,
  formatScore,
  type RetentionSignal,
  type RecruitmentVerdict,
} from './strategic-brain'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — these cover only the pure
// formatting calculators the strategic-brain screen (Task 13) will render. No network, no PII.

describe('retentionLabel', () => {
  it('maps every RetentionSignal to a distinct Polish label + semantic tone', () => {
    expect(retentionLabel('UTRZYMAC')).toEqual({ label: 'Utrzymać', tone: 'good' })
    expect(retentionLabel('INWESTOWAC')).toEqual({ label: 'Inwestować', tone: 'invest' })
    expect(retentionLabel('RYZYKO')).toEqual({ label: 'Ryzyko', tone: 'risk' })
    expect(retentionLabel('OBSERWOWAC')).toEqual({ label: 'Obserwować', tone: 'watch' })
  })

  it('covers all four signal values with unique labels', () => {
    const signals: RetentionSignal[] = ['UTRZYMAC', 'INWESTOWAC', 'RYZYKO', 'OBSERWOWAC']
    const labels = signals.map((s) => retentionLabel(s).label)
    expect(new Set(labels).size).toBe(4)
  })
})

describe('slopeIndicator', () => {
  it('null slope (M9: unknown trend, never risk) → dash / unknown', () => {
    expect(slopeIndicator(null)).toEqual({ arrow: '—', trend: 'unknown' })
  })

  it('a clearly positive slope → rising', () => {
    expect(slopeIndicator(5)).toEqual({ arrow: '↑', trend: 'rising' })
    expect(slopeIndicator(0.6)).toEqual({ arrow: '↑', trend: 'rising' })
  })

  it('a clearly negative slope → declining', () => {
    expect(slopeIndicator(-5)).toEqual({ arrow: '↓', trend: 'declining' })
    expect(slopeIndicator(-0.6)).toEqual({ arrow: '↓', trend: 'declining' })
  })

  it('a slope within the flat band (including exactly zero) → flat', () => {
    expect(slopeIndicator(0)).toEqual({ arrow: '→', trend: 'flat' })
    expect(slopeIndicator(0.01)).toEqual({ arrow: '→', trend: 'flat' })
    expect(slopeIndicator(-0.01)).toEqual({ arrow: '→', trend: 'flat' })
  })
})

describe('verdictLabel', () => {
  it('maps every RecruitmentVerdict to its Polish action label', () => {
    expect(verdictLabel('WZNOW')).toBe('Wznów rekrutację')
    expect(verdictLabel('WSTRZYMAJ')).toBe('Wstrzymaj rekrutację')
    expect(verdictLabel('UTRZYMAJ')).toBe('Utrzymaj')
  })

  it('covers all three verdict values with unique labels', () => {
    const verdicts: RecruitmentVerdict[] = ['WZNOW', 'WSTRZYMAJ', 'UTRZYMAJ']
    const labels = verdicts.map(verdictLabel)
    expect(new Set(labels).size).toBe(3)
  })
})

describe('confidenceDisclosure', () => {
  it('low confidence → the "too little data" disclosure (M10 UI disclosure)', () => {
    expect(confidenceDisclosure(0.1)).toBe('Ocena orientacyjna — za mało danych')
    expect(confidenceDisclosure(0.49)).toBe('Ocena orientacyjna — za mało danych')
  })

  it('high confidence with a meaningful peer group → no disclosure', () => {
    expect(confidenceDisclosure(0.9, true)).toBeNull()
    expect(confidenceDisclosure(1, true)).toBeNull()
  })

  it('high confidence but a non-meaningful (too-small) peer group → the peer-group disclosure', () => {
    expect(confidenceDisclosure(0.9, false)).toBe('Grupa zbyt mała — normalizacja orientacyjna')
  })

  it('defaults `meaningful` to true when omitted (only confidence gates the disclosure)', () => {
    expect(confidenceDisclosure(0.9)).toBeNull()
    expect(confidenceDisclosure(0.4)).toBe('Ocena orientacyjna — za mało danych')
  })

  it('low confidence takes precedence over a non-meaningful peer group', () => {
    expect(confidenceDisclosure(0.1, false)).toBe('Ocena orientacyjna — za mało danych')
  })

  it('the boundary value (exactly the threshold) counts as sufficiently confident', () => {
    expect(confidenceDisclosure(0.5, true)).toBeNull()
  })
})

describe('formatScore', () => {
  it('null → em dash', () => {
    expect(formatScore(null)).toBe('—')
  })

  it('rounds a fractional 0..100 score', () => {
    expect(formatScore(84.6)).toBe('85')
    expect(formatScore(84.4)).toBe('84')
    expect(formatScore(0)).toBe('0')
    expect(formatScore(100)).toBe('100')
  })
})
