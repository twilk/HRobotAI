import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { TenantPrisma } from '@hrobot/db'
import type { EmploymentType } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import type { AiConfigActor } from '../ai-grafik/ai-config.service.js'
import { AiConfigService } from '../ai-grafik/ai-config.service.js'
import { isoWeekRange, windowMinutes } from '../ai-grafik/week-range.util.js'
import { normalizePosition } from './position.util.js'

const { Decimal } = TenantPrisma

/** The acting user projected from the JWT + IP (identical shape to {@link AiConfigActor}). */
export type CostActor = AiConfigActor

/** A persisted standard hourly cost rate for a (position, employmentType) pair. */
export type CostRate = TenantPrisma.PositionCostRateGetPayload<Record<string, never>>

/** `PATCH /koszty/rates` input — HR/ADMIN only. `position` is normalized before it is ever written. */
export interface UpsertRateInput {
  position: string
  employmentType: EmploymentType
  hourlyRate: number | string
  currency?: string
}

/** The minimal shift-time shape {@link CostService.shiftCost} needs. */
export interface CostableShift {
  /** Shift start as "HH:mm". */
  start: string
  /** Shift end as "HH:mm". `end < start` is an overnight shift (+24h); `end === start` is 0h. */
  end: string
}

/**
 * A (position, employmentType) pair with no matching {@link CostRate} — surfaced instead of ever
 * silently treating the missing rate as a 0 cost (Codex Open-Q missing rate). `position` here is
 * already normalized (see {@link normalizePosition}).
 */
export interface MissingRate {
  position: string
  employmentType: EmploymentType
  employeeIds: string[]
}

/** {@link CostService.weekCost} result. */
export interface WeekCostResult {
  /** Total cost of all shifts THAT HAVE a matching rate, as a fixed 2dp decimal string. `null` when
   *  a {@link currencyConflict} makes summing meaningless. */
  cost: string | null
  /** The single currency the sum is denominated in, or `null` when there is nothing to sum yet or a
   *  currency conflict was detected. */
  currency: string | null
  missingRates: MissingRate[]
  /** `true` when shifts in scope draw rates in more than one currency — MVP refuses to sum PLN+EUR. */
  currencyConflict: boolean
}

/** {@link CostService.budgetStatus} result. */
export interface BudgetStatusResult extends WeekCostResult {
  /** The effective weekly cap for this scope (Codex P1-3 fallback), or `null` when none applies. */
  cap: string | null
  /**
   * `true`/`false` only when the comparison is fully known; `null` when it CANNOT be honestly
   * asserted — either a currency conflict, or a missing rate whose unknown contribution could still
   * push the real total over the cap even though the known partial sum does not (Codex Open-Q missing
   * rate: "budget OK must NOT be asserted while any rate is missing"). If the known partial sum
   * ALREADY exceeds the cap despite missing rates, `true` is still reported — the real total can only
   * be equal or higher.
   */
  overBudget: boolean | null
}

/** Params for {@link CostService.weekCost} / {@link CostService.budgetStatus}. */
export interface WeekScope {
  /** Any date inside the target ISO week (normalized via {@link isoWeekRange}). */
  weekStart: Date
  /** Required for a MANAGER (Codex P1-3); optional for a global HR/ADMIN view (omitted = tenant-wide). */
  unitId?: string
}

/**
 * Shift-cost calculator + weekly budget status (SP4). MVP computes ONLY `hours × hourlyRate` — NO
 * overtime multiplier is applied even though `PositionCostRate.overtimeMultiplier` exists on the
 * schema for a future phase (Codex P1-4). `position` is free text on `Employee.position`; every
 * write and lookup normalizes it first (Codex P1-5) so cosmetic whitespace never produces a silent
 * miss. Rate WRITES are HR/ADMIN only (re-checked here even though the controller also gates on
 * `@Roles`); rate/week READS are open to MANAGER/HR/ADMIN, with a MANAGER scoped to their own units.
 */
@Injectable()
export class CostService {
  constructor(
    private readonly audit: AuditService,
    private readonly aiConfig: AiConfigService,
  ) {}

  private writeAudit(client: TenantClient, actor: CostActor, action: string, id: string, payload: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action, entityType: 'PositionCostRate', entityId: id, payload, ipAddress: actor.ipAddress })
  }

  /** All persisted rates. Read-only — MANAGER/HR/ADMIN access is gated by the controller `@Roles`. */
  async getRates(client: TenantClient): Promise<CostRate[]> {
    return client.positionCostRate.findMany({ orderBy: [{ position: 'asc' }, { employmentType: 'asc' }] })
  }

  /**
   * Create-or-update the standard hourly rate for a (position, employmentType) pair. HR/ADMIN only
   * (Codex P1-1 — this must NEVER reuse the `[MANAGER, HR, ADMIN_KLIENTA]` config route's roles).
   * `position` is normalized (trim + collapse whitespace) before the unique-key write so it matches
   * the same normalization {@link weekCost} applies to an `Employee.position` lookup.
   */
  async upsertRate(client: TenantClient, actor: CostActor, dto: UpsertRateInput): Promise<CostRate> {
    if (!isGlobal(actor.roles)) throw new ForbiddenException('Only HR/ADMIN may write position cost rates')

    const position = normalizePosition(dto.position)
    if (!position) throw new BadRequestException('position must not be blank')

    const where = { position_employmentType: { position, employmentType: dto.employmentType } }
    const before = await client.positionCostRate.findUnique({ where })
    const data = {
      position,
      employmentType: dto.employmentType,
      hourlyRate: dto.hourlyRate,
      currency: dto.currency ?? 'PLN',
    }
    const after = await client.positionCostRate.upsert({ where, update: data, create: data })

    await this.writeAudit(client, actor, 'position_cost_rate.upserted', after.id, { before, after })
    return after
  }

  /**
   * PURE: hours × hourlyRate for one shift. Overnight (`end < start`) adds 24h via
   * {@link windowMinutes}; `end === start` is 0h (NOT a 24h shift) — both match
   * `replacement.service.ts`'s existing window semantics exactly. Deliberately does NOT read or
   * apply `rate.overtimeMultiplier` — MVP has no overtime concept (Codex P1-4).
   */
  shiftCost(rate: { hourlyRate: TenantPrisma.Decimal | number | string }, shift: CostableShift): InstanceType<typeof Decimal> {
    const hours = new Decimal(windowMinutes(shift.start, shift.end)).div(60)
    return new Decimal(rate.hourlyRate).mul(hours)
  }

  /**
   * Rates for a small set of (position, employmentType) pairs in ONE query — every `position` is
   * normalized first (Codex P1-5), matching the write-side normalization in {@link upsertRate}.
   * Shared by {@link weekCost}'s own per-shift pair lookup and by `AiProposalService`'s Δcost hook
   * (Codex P1-6), so both do a single `OR` query rather than re-deriving the normalize+match logic.
   */
  async findRatesForPairs(
    client: TenantClient,
    pairs: { position: string; employmentType: EmploymentType }[],
  ): Promise<CostRate[]> {
    if (pairs.length === 0) return []
    const normalized = pairs.map((p) => ({ position: normalizePosition(p.position), employmentType: p.employmentType }))
    return client.positionCostRate.findMany({ where: { OR: normalized } })
  }

  /**
   * The [Monday, next-Monday) week of shifts in scope, scoped by unit (Codex P1-3: a MANAGER MUST
   * pass a `unitId` they manage; a global HR/ADMIN may omit it for a tenant-wide sum). Sums only the
   * shifts whose (normalized position, employmentType) has a matching {@link CostRate} — every other
   * shift is reported in `missingRates` instead of contributing a phantom 0. A mixed-currency rate
   * set in scope aborts the sum entirely (`currencyConflict: true`, `cost: null`).
   */
  async weekCost(client: TenantClient, actor: CostActor, scope: WeekScope): Promise<WeekCostResult> {
    await this.assertWeekScope(client, actor, scope.unitId)

    const { weekStart, weekEndExcl } = isoWeekRange(scope.weekStart)
    const where: TenantPrisma.ShiftWhereInput = { date: { gte: weekStart, lt: weekEndExcl } }
    if (scope.unitId) where.employee = { unitId: scope.unitId }

    const shifts = await client.shift.findMany({
      where,
      select: {
        employeeId: true,
        start: true,
        end: true,
        employee: { select: { position: true, employmentType: true } },
      },
    })

    if (shifts.length === 0) return { cost: '0.00', currency: null, missingRates: [], currencyConflict: false }

    // One rate lookup for every DISTINCT (normalized position, employmentType) pair in scope.
    const pairKey = (position: string, employmentType: EmploymentType) => `${position} ${employmentType}`
    const pairs = new Map<string, { position: string; employmentType: EmploymentType }>()
    for (const s of shifts) {
      const position = normalizePosition(s.employee.position)
      const employmentType = s.employee.employmentType as EmploymentType
      pairs.set(pairKey(position, employmentType), { position, employmentType })
    }
    const rates = pairs.size
      ? await client.positionCostRate.findMany({
          where: { OR: [...pairs.values()].map((p) => ({ position: p.position, employmentType: p.employmentType })) },
        })
      : []
    const rateByPair = new Map(rates.map((r) => [pairKey(r.position, r.employmentType as EmploymentType), r]))

    let total = new Decimal(0)
    let currency: string | null = null
    let currencyConflict = false
    const missingByPair = new Map<string, MissingRate>()

    for (const s of shifts) {
      const position = normalizePosition(s.employee.position)
      const employmentType = s.employee.employmentType as EmploymentType
      const key = pairKey(position, employmentType)
      const rate = rateByPair.get(key)

      if (!rate) {
        const existing = missingByPair.get(key) ?? { position, employmentType, employeeIds: [] }
        if (!existing.employeeIds.includes(s.employeeId)) existing.employeeIds.push(s.employeeId)
        missingByPair.set(key, existing)
        continue
      }

      if (currency === null) currency = rate.currency
      else if (currency !== rate.currency) currencyConflict = true

      total = total.add(this.shiftCost(rate, s))
    }

    const missingRates = [...missingByPair.values()]
    if (currencyConflict) return { cost: null, currency: null, missingRates, currencyConflict: true }
    return { cost: total.toFixed(2), currency, missingRates, currencyConflict: false }
  }

  /**
   * `weekCost` plus the effective budget cap comparison (Codex P1-3 fallback via
   * `AiConfigService.getEffectiveBudgetCap`: unit cap → global cap → no cap). `overBudget` is only
   * ever asserted `true`/`false` when the comparison is fully trustworthy — see
   * {@link BudgetStatusResult.overBudget}.
   */
  async budgetStatus(client: TenantClient, actor: CostActor, unitId: string | undefined, weekStart: Date): Promise<BudgetStatusResult> {
    const week = await this.weekCost(client, actor, { weekStart, unitId })
    const { cap } = await this.aiConfig.getEffectiveBudgetCap(client, unitId ?? null)

    let overBudget: boolean | null
    if (week.currencyConflict || week.cost === null) {
      overBudget = null
    } else if (cap === null) {
      overBudget = false
    } else {
      const known = new Decimal(week.cost)
      const capDecimal = new Decimal(cap)
      if (known.greaterThan(capDecimal)) {
        overBudget = true // already over on known data alone — the real total can only be >=.
      } else if (week.missingRates.length > 0) {
        overBudget = null // cannot honestly assert "OK" while a rate is missing.
      } else {
        overBudget = false
      }
    }

    return { ...week, cap, overBudget }
  }

  /** Codex P1-3: a MANAGER must pass a `unitId` they manage; a global actor may pass any/none. */
  private async assertWeekScope(client: TenantClient, actor: CostActor, unitId?: string): Promise<void> {
    if (isGlobal(actor.roles)) return
    if (!unitId) throw new ForbiddenException('unitId is required for a manager cost view')
    const managed = await managedUnitIds(client, actor.userId)
    if (!managed.includes(unitId)) throw new ForbiddenException('Cost data is outside your scope')
  }
}
