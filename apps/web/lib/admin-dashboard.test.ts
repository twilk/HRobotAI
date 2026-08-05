import { describe, expect, it } from 'vitest'
import {
  countUnitsWithoutManager,
  countUsersWithoutRoles,
  countInactiveUsers,
  needsAttentionCount,
  type UnitManagerCheck,
} from './admin-dashboard'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node' — these cover only the pure
// helpers the HR/ADMIN dashboard board relies on (no network, no PII, no DOM).

describe('countUnitsWithoutManager', () => {
  it('returns 0 for an empty tree', () => {
    expect(countUnitsWithoutManager([])).toBe(0)
  })

  it('counts root units with no manager', () => {
    const units: UnitManagerCheck[] = [
      { id: '1', managerUserId: 'u1', children: [] },
      { id: '2', managerUserId: null, children: [] },
    ]
    expect(countUnitsWithoutManager(units)).toBe(1)
  })

  it('recurses into nested children', () => {
    const units: UnitManagerCheck[] = [
      {
        id: '1',
        managerUserId: 'u1',
        children: [
          { id: '1a', managerUserId: null, children: [] },
          {
            id: '1b',
            managerUserId: 'u2',
            children: [{ id: '1b-i', managerUserId: null, children: [] }],
          },
        ],
      },
    ]
    expect(countUnitsWithoutManager(units)).toBe(2)
  })

  it('counts every unit when the whole tree has no managers', () => {
    const units: UnitManagerCheck[] = [
      { id: '1', managerUserId: null, children: [{ id: '1a', managerUserId: null, children: [] }] },
    ]
    expect(countUnitsWithoutManager(units)).toBe(2)
  })
})

describe('countUsersWithoutRoles', () => {
  it('returns 0 for an empty roster', () => {
    expect(countUsersWithoutRoles([])).toBe(0)
  })

  it('counts users with an empty roles array', () => {
    const users = [{ roles: [] }, { roles: [{ role: 'MANAGER' }] }, { roles: [] }]
    expect(countUsersWithoutRoles(users)).toBe(2)
  })

  it('returns 0 when every user has at least one role', () => {
    const users = [{ roles: [{ role: 'HR' }] }, { roles: [{ role: 'ADMIN_KLIENTA' }] }]
    expect(countUsersWithoutRoles(users)).toBe(0)
  })
})

describe('countInactiveUsers', () => {
  it('counts only accounts explicitly active:false', () => {
    expect(countInactiveUsers([{ active: true }, { active: false }, { active: false }])).toBe(2)
  })
  it('treats a missing active flag as active (not counted)', () => {
    expect(countInactiveUsers([{}, { active: true }])).toBe(0)
  })
})

describe('needsAttentionCount', () => {
  it('counts how many signals are non-zero', () => {
    expect(needsAttentionCount({ unitsWithoutManager: 4, usersWithoutRoles: 0, inactiveUsers: 0 })).toBe(1)
    expect(needsAttentionCount({ unitsWithoutManager: 4, usersWithoutRoles: 2, inactiveUsers: 1 })).toBe(3)
    expect(needsAttentionCount({ unitsWithoutManager: 0, usersWithoutRoles: 0, inactiveUsers: 0 })).toBe(0)
  })
})
