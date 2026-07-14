import { describe, expect, it } from 'vitest'
import {
  mondayOf,
  addDaysIso,
  decisionTotal,
  sortDecisions,
  topVacated,
  vacatedWho,
  pickPrimaryCostUnit,
  type DecisionItem,
  type VacatedShiftView,
} from './manager-dashboard'

const vac = (id: string, date: string, start: string): VacatedShiftView => ({
  id,
  date,
  start,
  end: '16:00',
  role: 'SERWISANT',
  lokalizacjaId: 'lok-1',
  employee: { firstName: 'Marek', lastName: 'Piotrowski' },
})

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

describe('topVacated', () => {
  it('sorts by date then start time and limits, reporting the overflow', () => {
    const shifts = [
      vac('c', '2026-07-16', '06:00'),
      vac('a', '2026-07-15', '08:00'),
      vac('b', '2026-07-15', '06:00'),
      vac('d', '2026-07-17', '14:00'),
      vac('e', '2026-07-18', '06:00'),
    ]
    const { shown, more } = topVacated(shifts, 4)
    expect(shown.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(more).toBe(1)
  })

  it('reports 0 overflow when under the limit and does not mutate input', () => {
    const shifts = [vac('a', '2026-07-15', '08:00')]
    const copy = [...shifts]
    const { shown, more } = topVacated(shifts, 4)
    expect(shown).toHaveLength(1)
    expect(more).toBe(0)
    expect(shifts).toEqual(copy)
  })
})

describe('vacatedWho', () => {
  it('joins first and last name', () => {
    expect(vacatedWho(vac('a', '2026-07-15', '08:00'))).toBe('Marek Piotrowski')
  })
})

describe('pickPrimaryCostUnit', () => {
  const e = (name: string, cost: string | number | null) => ({ unit: { id: name, name }, week: { cost } })

  it('picks the highest real cost, skipping the 0-cost root and null (out-of-scope) units', () => {
    const picked = pickPrimaryCostUnit([
      e('4Mobility — Operacje', '0.00'),
      e('Region Centrum', '7760.00'),
      e('Region Południe', null),
    ])
    expect(picked?.unit.name).toBe('Region Centrum')
    expect(picked?.week.cost).toBe('7760.00')
  })

  it('returns null when no unit has a cost', () => {
    expect(pickPrimaryCostUnit([e('a', null), e('b', null)])).toBeNull()
  })
})
