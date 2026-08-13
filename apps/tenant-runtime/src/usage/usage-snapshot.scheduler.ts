import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { TenantPrismaManager } from '@hrobot/db'
import { TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

/**
 * Nightly headcount capture — one row per (tenant, month) in the control-plane DB.
 *
 * WHY THIS EXISTS. `TODOS.md` has carried "Billing / trial gate … no paywall, plan selection, trial
 * expiry, or metering" since 2026-05-31, and it stayed parked because the conversation always
 * started at "design a pricing model". It does not need to. Any per-seat model needs exactly one
 * input — how many people are in the product — and with database-per-tenant nobody could answer that
 * without an N-database fan-out. This scheduler answers it once a night and writes it down. No UI, no
 * plan gating, no prices: those are decisions, and this is the number they need.
 *
 * WHAT IT COUNTS, PRECISELY. `employeesOnRecord` is `employee.count()` in each tenant database —
 * people on the books. NOT people actively employed today. The tenant schema has `hiredAt` and NO
 * termination or employment-status column, so "still employed" is not derivable from it. That same
 * missing column is why the retired turnover metrics were wrong: they inferred "left the company"
 * from account deactivation, which is not the same event. Rather than repeat that mistake with a
 * friendlier name, this counts what it can count and is named for it. Adding a real employment-status
 * column is a product decision and a tenant-schema migration — deliberately out of scope here.
 *
 * SHAPE COPIED, NOT INVENTED. Tenant iteration (`ControlPlanePrismaService.tenant.findMany`),
 * per-tenant client acquisition (`TenantPrismaManager.withClient`), best-effort per-tenant error
 * handling and the `@Cron` cadence all mirror {@link StrategicBrainScheduler}. Runs at 3 AM because
 * that scheduler owns 2 AM and a headcount is cheap but the tenant-client LRU is shared.
 *
 * IDEMPOTENT BY CONSTRUCTION. The write is an upsert on the `(tenantId, month)` unique index, so a
 * second run in the same month overwrites rather than appends — no advisory lock needed. Two
 * concurrent runs can race to write the same row; the loser's value is the same count or a few
 * seconds staler, which for a monthly grain is not a difference worth a lock.
 */
@Injectable()
export class UsageSnapshotScheduler {
  private readonly logger = new Logger(UsageSnapshotScheduler.name)

  constructor(
    private readonly controlPlanePrisma: ControlPlanePrismaService,
    private readonly tenantManager: TenantPrismaManager,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    await this.captureAll(new Date())
  }

  /**
   * The cron body, with `now` injected so a test can pin the month without stubbing the clock.
   * Returns the number of tenants successfully captured — the caller logs it; tests assert on it.
   */
  async captureAll(now: Date): Promise<number> {
    const month = monthKey(now)
    const tenants = await this.controlPlanePrisma.tenant.findMany({
      where: { status: TenantStatus.ACTIVE },
      select: { id: true },
    })

    let captured = 0
    for (const tenant of tenants) {
      try {
        await this.captureTenant(tenant.id, month)
        captured += 1
      } catch (err) {
        // Best-effort per tenant: one unreachable tenant database must not cost us every other
        // tenant's number for the month. Mirrors StrategicBrainScheduler's per-tenant catch.
        this.logger.error({ err, tenantId: tenant.id, month }, 'usage: headcount capture failed for tenant')
      }
    }

    this.logger.log({ month, captured, total: tenants.length }, 'usage: monthly headcount captured')
    return captured
  }

  private async captureTenant(tenantId: string, month: string): Promise<void> {
    const employeesOnRecord = await this.tenantManager.withClient(tenantId, (client) => client.employee.count())

    await this.controlPlanePrisma.tenantUsageSnapshot.upsert({
      where: { tenantId_month: { tenantId, month } },
      create: { tenantId, month, employeesOnRecord },
      update: { employeesOnRecord, capturedAt: new Date() },
    })
  }
}

/**
 * Calendar month as `YYYY-MM`, in UTC.
 *
 * UTC and not Europe/Warsaw on purpose: the boundary must not move twice a year with DST, and a
 * snapshot taken at 03:00 local on the 1st would otherwise land in the previous month for half the
 * year. The grain is a month; which side of midnight the capture runs on must not change the answer.
 */
export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}
