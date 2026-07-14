// Pure helpers for the HR/ADMIN "governance" dashboard board (components/dashboard/admin-board.tsx).
// Split out from the component so the org-health aggregation is unit-testable without a DOM/render
// harness — this repo's vitest config only runs `lib/**/*.test.ts` under a `node` environment (no
// jsdom / @testing-library/react installed), see vitest.config.ts.

/** The subset of `OrgUnit` (lib/ustawienia.ts) this helper needs — kept minimal so callers don't
 *  have to import the full ustawienia client just to count. */
export interface UnitManagerCheck {
  id: string
  managerUserId: string | null
  children: UnitManagerCheck[]
}

/**
 * Count of units with no assigned manager (`managerUserId == null`), walking the FULL nested tree
 * (a unit's `children` are already nested {@link UnitManagerCheck} objects here — the caller nests the
 * flat `GET /ustawienia/units` list via `buildUnitTree` from lib/ustawienia.ts before calling this).
 */
export function countUnitsWithoutManager(units: UnitManagerCheck[]): number {
  let count = 0
  const walk = (nodes: UnitManagerCheck[]) => {
    for (const node of nodes) {
      if (node.managerUserId == null) count += 1
      if (node.children.length > 0) walk(node.children)
    }
  }
  walk(units)
  return count
}

/** The subset of `TenantUser` (lib/uzytkownicy.ts) this helper needs. */
export interface UserRolesCheck {
  roles: unknown[]
}

/** Count of users with zero role grants — an account that can sign in but do nothing. */
export function countUsersWithoutRoles(users: UserRolesCheck[]): number {
  return users.filter((u) => u.roles.length === 0).length
}

/** The subset of `TenantUser` needed to flag deactivated accounts. */
export interface UserActiveCheck {
  active?: boolean
}

/** Count of deactivated accounts (`active === false`) — a disabled login still on the books. */
export function countInactiveUsers(users: UserActiveCheck[]): number {
  return users.filter((u) => u.active === false).length
}

/** The three governance signals feeding the "Zdrowie organizacji" card. */
export interface GovernanceSignals {
  unitsWithoutManager: number
  usersWithoutRoles: number
  inactiveUsers: number
}

/** How many governance signals are non-zero — drives the card's "wymaga uwagi: N" / "wszystko OK" verdict. */
export function needsAttentionCount(s: GovernanceSignals): number {
  return [s.unitsWithoutManager, s.usersWithoutRoles, s.inactiveUsers].filter((n) => n > 0).length
}
