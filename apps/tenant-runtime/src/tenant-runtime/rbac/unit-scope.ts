import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'

/** HR and the tenant admin act across every unit; MANAGER is scoped to the unit(s) they manage. */
const GLOBAL_ROLES: string[] = [Role.HR, Role.ADMIN_KLIENTA]

export const isGlobal = (roles: string[]): boolean => roles.some((r) => GLOBAL_ROLES.includes(r))

/** Unit IDs the user holds a MANAGER role for (via tenant `UserRole`). */
export async function managedUnitIds(client: TenantClient, userId: string): Promise<string[]> {
  const rows = await client.userRole.findMany({
    where: { user: { keycloakSub: userId }, role: Role.MANAGER, unitId: { not: null } },
    select: { unitId: true },
  })
  return rows.map((r) => r.unitId).filter((u): u is string => u !== null)
}
