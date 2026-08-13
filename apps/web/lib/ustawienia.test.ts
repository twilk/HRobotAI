import { describe, expect, it } from 'vitest'
import { buildUnitTree, indexUnits, wouldCreateCycle, type OrgUnit } from './ustawienia'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — pure helpers only, no network,
// no PII (org units carry no PII per SettingsService's class doc).

function unit(id: string, name: string, parentId: string | null = null, managerUserId: string | null = null): OrgUnit {
  return { id, name, parentId, managerUserId, children: [] }
}

describe('buildUnitTree', () => {
  it('nests children under their parent, root units at the top level', () => {
    const units: OrgUnit[] = [
      unit('root', 'Centrala', null),
      unit('a', 'Oddział A', 'root'),
      unit('b', 'Oddział B', 'root'),
      unit('a1', 'Zespół A1', 'a'),
    ]
    const tree = buildUnitTree(units)
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('root')
    expect(tree[0].children.map((c) => c.id).sort()).toEqual(['a', 'b'])
    const nodeA = tree[0].children.find((c) => c.id === 'a')!
    expect(nodeA.children).toHaveLength(1)
    expect(nodeA.children[0].id).toBe('a1')
  })

  it('supports multiple root units (a forest, not just one tree)', () => {
    const units: OrgUnit[] = [unit('r1', 'Warszawa', null), unit('r2', 'Kraków', null)]
    const tree = buildUnitTree(units)
    expect(tree.map((n) => n.id).sort()).toEqual(['r1', 'r2'])
  })

  it('sorts siblings by Polish-locale name at every level', () => {
    const units: OrgUnit[] = [unit('root', 'Centrala', null), unit('z', 'Żłobek', 'root'), unit('a', 'Administracja', 'root')]
    const tree = buildUnitTree(units)
    expect(tree[0].children.map((c) => c.name)).toEqual(['Administracja', 'Żłobek'])
  })

  it('treats a unit with an unresolvable parentId as a root instead of dropping it', () => {
    const units: OrgUnit[] = [unit('orphan', 'Sierota', 'does-not-exist')]
    const tree = buildUnitTree(units)
    expect(tree.map((n) => n.id)).toEqual(['orphan'])
  })

  it('returns an empty forest for an empty list', () => {
    expect(buildUnitTree([])).toEqual([])
  })
})

describe('indexUnits', () => {
  it('maps id -> unit for O(1) lookup', () => {
    const units: OrgUnit[] = [unit('a', 'Oddział A'), unit('b', 'Oddział B')]
    const idx = indexUnits(units)
    expect(idx.get('a')?.name).toBe('Oddział A')
    expect(idx.get('missing')).toBeUndefined()
  })
})

describe('wouldCreateCycle', () => {
  const units: OrgUnit[] = [
    unit('root', 'Centrala', null),
    unit('a', 'Oddział A', 'root'),
    unit('a1', 'Zespół A1', 'a'),
    unit('a1x', 'Podzespół A1x', 'a1'),
    unit('b', 'Oddział B', 'root'),
  ]

  it('flags a self-parent', () => {
    expect(wouldCreateCycle(units, 'a', 'a')).toBe(true)
  })

  it('flags reparenting under a direct descendant', () => {
    expect(wouldCreateCycle(units, 'a', 'a1')).toBe(true)
  })

  it('flags reparenting under a deeper descendant', () => {
    expect(wouldCreateCycle(units, 'a', 'a1x')).toBe(true)
  })

  it('allows reparenting under an unrelated unit', () => {
    expect(wouldCreateCycle(units, 'a1', 'b')).toBe(false)
  })

  it('allows clearing the parent (becoming a root)', () => {
    expect(wouldCreateCycle(units, 'a', null)).toBe(false)
  })

  it('allows reparenting to the current parent (no-op move)', () => {
    expect(wouldCreateCycle(units, 'a1', 'a')).toBe(false)
  })

  it('does not flag an unresolvable parentId as a cycle (that is a backend 400 instead)', () => {
    expect(wouldCreateCycle(units, 'a', 'does-not-exist')).toBe(false)
  })

  it('terminates instead of looping forever on a corrupt cyclic snapshot', () => {
    const corrupt: OrgUnit[] = [unit('x', 'X', 'y'), unit('y', 'Y', 'x')]
    expect(wouldCreateCycle(corrupt, 'z', 'x')).toBe(false)
  })
})
