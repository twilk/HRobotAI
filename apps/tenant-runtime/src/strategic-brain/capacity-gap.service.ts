import { Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'

/**
 * Per-role capacity gap for one location × week (spec §14 finding B5).
 *
 * `required`/`assigned` are both derived from **persisted** rows — `ShiftDemand.requiredCount`
 * and the count of `Shift` rows linked back to that demand via `Shift.demandId` (the
 * `ShiftDemand.shifts` relation) — never from a solver's ephemeral `unmet[]` output. The same DB
 * state therefore always yields the same gap, which is what makes a recruitment recommendation
 * built on top of it reproducible.
 *
 * `gap` is NOT clamped at zero: `gap > 0` means understaffed (a recruitment signal), `gap === 0`
 * means exactly covered, and `gap < 0` means overstaffed (more assigned `Shift` rows than the
 * demand's `requiredCount` — e.g. a manager manually double-booked a slot). Callers that only care
 * about shortage should filter on `gap > 0` themselves; clamping here would destroy the
 * overstaffing signal.
 */
export interface RoleCapacityGap {
  role: string
  required: number
  assigned: number
  gap: number
}

export interface CapacityGapResult {
  lokalizacjaId: string
  weekStart: Date
  byRole: RoleCapacityGap[]
  totalGap: number
}

@Injectable()
export class CapacityGapService {
  /**
   * Sum of `ShiftDemand.requiredCount` minus the count of assigned `Shift` rows (via
   * `Shift.demandId`), grouped by `ShiftDemand.requiredRole`, for every demand at `lokalizacjaId`
   * whose `date` falls in the 7-day window `[weekStart, weekStart + 7d)` — the same week-window
   * convention `GrafikService.solveGrafik` uses when packing demands for the solver.
   *
   * Pure query: no solver invocation, no writes.
   */
  async capacityGap(client: TenantClient, lokalizacjaId: string, weekStart: Date): Promise<CapacityGapResult> {
    const weekEndExcl = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)

    const demands = await client.shiftDemand.findMany({
      where: {
        lokalizacjaId,
        date: { gte: weekStart, lt: weekEndExcl },
      },
      include: { shifts: true },
    })

    const byRoleMap = new Map<string, { required: number; assigned: number }>()
    for (const d of demands) {
      const entry = byRoleMap.get(d.requiredRole) ?? { required: 0, assigned: 0 }
      entry.required += d.requiredCount
      entry.assigned += d.shifts.length
      byRoleMap.set(d.requiredRole, entry)
    }

    const byRole: RoleCapacityGap[] = [...byRoleMap.entries()]
      .map(([role, { required, assigned }]) => ({ role, required, assigned, gap: required - assigned }))
      .sort((a, b) => a.role.localeCompare(b.role))

    const totalGap = byRole.reduce((sum, r) => sum + r.gap, 0)

    return { lokalizacjaId, weekStart, byRole, totalGap }
  }
}
