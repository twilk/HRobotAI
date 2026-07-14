import { describe, expect, it } from 'vitest'
import { mondayOf, addDaysIso, decisionTotal, sortDecisions, type DecisionItem } from './manager-dashboard'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — these cover only the pure
// helpers the MANAGER dashboard board relies on (no network, no PII, no DOM).

describe('mondayOf', () => {
  it('returns the same date when given a Monday', () => {
    // 2026-07-13 is a Monday
    expect(mondayOf('2026-07-13')).toBe('2026-07-13')
  })

  it('returns the containing Monday for a midweek date', () => {
    // 2026-07-16 is a Thursday
    expect(mondayOf('2026-07-16')).toBe('2026-07-13')
  })

  it('returns the containing Monday for a Sunday', () => {
    // 2026-07-19 is the Sunday of the same week
    expect(mondayOf('2026-07-19')).toBe('2026-07-13')
  })

  it('normalizes a full ISO datetime before computing', () => {
    expect(mondayOf('2026-07-16T00:00:00.000Z')).toBe('2026-07-13')
  })
})

describe('addDaysIso', () => {
  it('adds positive days across a month boundary', () => {
    expect(addDaysIso('2026-07-25', 14)).toBe('2026-08-08')
  })

  it('adds zero days as a no-op', () => {
    expect(addDaysIso('2026-07-13', 0)).toBe('2026-07-13')
  })

  it('supports negative offsets', () => {
    expect(addDaysIso('2026-07-13', -1)).toBe('2026-07-12')
  })
})

describe('decisionTotal', () => {
  it('sums all three counts', () => {
    expect(decisionTotal({ wnioski: 2, swaps: 1, proposals: 3 })).toBe(6)
  })

  it('returns 0 when all counts are 0', () => {
    expect(decisionTotal({ wnioski: 0, swaps: 0, proposals: 0 })).toBe(0)
  })
})

describe('sortDecisions', () => {
  const items: DecisionItem[] = [
    { key: 'wnioski', label: 'Wnioski', count: 0, href: '/wnioski' },
    { key: 'swaps', label: 'Zamiany', count: 2, href: '/zamiany' },
    { key: 'proposals', label: 'Propozycje AI', count: 5, href: '/ai-grafik-manager' },
  ]

  it('puts nonzero counts first, highest first', () => {
    expect(sortDecisions(items).map((i) => i.key)).toEqual(['proposals', 'swaps', 'wnioski'])
  })

  it('keeps original relative order among equal counts', () => {
    const tied: DecisionItem[] = [
      { key: 'a', label: 'A', count: 1, href: '/a' },
      { key: 'b', label: 'B', count: 1, href: '/b' },
    ]
    expect(sortDecisions(tied).map((i) => i.key)).toEqual(['a', 'b'])
  })

  it('keeps original relative order among all-zero counts', () => {
    const zeros: DecisionItem[] = [
      { key: 'a', label: 'A', count: 0, href: '/a' },
      { key: 'b', label: 'B', count: 0, href: '/b' },
    ]
    expect(sortDecisions(zeros).map((i) => i.key)).toEqual(['a', 'b'])
  })

  it('does not mutate the input array', () => {
    const copy = [...items]
    sortDecisions(items)
    expect(items).toEqual(copy)
  })
})
