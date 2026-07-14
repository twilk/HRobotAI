import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createHash } from 'node:crypto'
import type { TenantClient } from '@hrobot/db'
import { TenantPrismaManager } from '@hrobot/db'
import { TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { SnapshotService, type SnapshotWindow } from './snapshot.service.js'
import { RecommendationService, type FinalizeWindow, type RecoScope } from './recommendation.service.js'
import { PerformanceConfigService } from './performance-config.service.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

interface EmployeeIdRow { id: string }
interface LokalizacjaIdRow { id: string }
interface LockRow { locked: boolean }

/**
 * `strategic-brain` background scheduler (spec §5, §14 findings B4/M14; plan Task 8).
 *
 * Runs the "ciągle i autonomicznie" (continuous, autonomous) analysis pass on its own — no manual
 * trigger. Mirrors `OutboxRelayService` (`@Cron`) and the real per-tenant client acquisition path
 * `TenantContextInterceptor` uses (`TenantPrismaManager`), NOT an invented tenant-iteration API:
 * tenants come from `ControlPlanePrismaService.tenant.findMany` (the same control-plane DB
 * `TenantContextInterceptor` reads), and the per-tenant DB connection comes from
 * `TenantPrismaManager.withClient` (the borrow-scoped variant — a scheduler pass can touch every
 * employee + location in a tenant, so the client must not be evicted/disconnected mid-run the way a
 * bare `getClient()` could allow under LRU pressure).
 *
 * [B4/M14] Two app instances (or two overlapping runs of the same instance) must never double-compute
 * the same tenant concurrently. Guarded with a per-tenant Postgres advisory lock,
 * `pg_try_advisory_xact_lock` — the NON-blocking, transaction-scoped variant: if another run already
 * holds the lock for this tenant, `locked` comes back `false` and this pass SKIPS the tenant this
 * round (no work, no error, no wait) rather than blocking the scheduler tick on a competing run. The
 * lock is released automatically when the transaction ends (commit or rollback), so no explicit
 * unlock call is needed.
 *
 * This class is orchestration + locking + tenant iteration ONLY. Every scoring/finalization/
 * recommendation rule lives in {@link SnapshotService} / {@link RecommendationService} — re-running
 * this scheduler is idempotent purely because those services already are (B2 snapshot upsert, B4
 * recommendation change-detection dedup).
 */
@Injectable()
export class StrategicBrainScheduler {
  private readonly logger = new Logger(StrategicBrainScheduler.name)

  constructor(
    private readonly controlPlanePrisma: ControlPlanePrismaService,
    private readonly tenantManager: TenantPrismaManager,
    private readonly snapshotService: SnapshotService,
    private readonly recommendationService: RecommendationService,
    private readonly configService: PerformanceConfigService,
  ) {}

  // Cadence: nightly, off-hours. The autonomous "ciągle i sam z siebie" analysis runs once a day and
  // MATERIALIZES snapshots/recommendations; the UI serves them PULL-side from persisted rows, so the
  // feed is always "already computed" without a manual trigger. Nightly (not every-5-min) keeps a
  // live demo deterministic — the seeded/materialized state is not silently recomputed mid-walkthrough.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async run(): Promise<void> {
    const tenants = await this.controlPlanePrisma.tenant.findMany({
      where: { status: TenantStatus.ACTIVE },
      select: { id: true },
    })

    for (const tenant of tenants) {
      try {
        await this.runForTenant(tenant.id)
      } catch (err) {
        // Best-effort per-tenant (Task 8): one tenant's failure must never abort the batch.
        this.logger.error({ err, tenantId: tenant.id }, 'strategic-brain: analysis run failed for tenant')
      }
    }
  }

  private async runForTenant(tenantId: string): Promise<void> {
    await this.tenantManager.withClient(tenantId, async (client) => {
      await client.$transaction(async (tx) => {
        const rows = (await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${this.advisoryLockKey(tenantId)}) AS locked`) as LockRow[]
        const locked = rows[0]?.locked === true
        if (!locked) {
          this.logger.debug({ tenantId }, 'strategic-brain: lock held by another run, skipping this tenant this round')
          return
        }
        await this.analyzeTenant(tx as TenantClient)
      })
    })
  }

  /** Under the advisory lock: snapshot every employee for the current window, finalize the window
   * (trajectory + final composite), emit retention signals, then emit a recruitment verdict per
   * location scope for the current week. Pure orchestration — no scoring here. */
  private async analyzeTenant(tx: TenantClient): Promise<void> {
    const cfg = (await this.configService.getEffectiveConfig(tx, null)) as { windowDays: unknown }
    const window = this.currentWindow(Number(cfg.windowDays))
    const weekStart = this.currentWeekStart()

    const employees = (await tx.employee.findMany({ select: { id: true } })) as EmployeeIdRow[]
    for (const employee of employees) {
      await this.snapshotService.computeSnapshot(tx, employee.id, window)
    }

    await this.recommendationService.finalizeWindow(tx, window)
    await this.recommendationService.emitRetention(tx, window)

    const locations = (await tx.lokalizacja.findMany({ select: { id: true } })) as LokalizacjaIdRow[]
    for (const location of locations) {
      const scope: RecoScope = { scopeType: 'LOKALIZACJA', scopeId: location.id }
      await this.recommendationService.emitRecruitment(tx, scope, weekStart)
    }
  }

  /** Deterministic, epoch-aligned window: `[floor(now/windowMs)*windowMs, +windowMs)`. Aligning to
   * fixed boundaries (rather than a rolling `now - windowDays`) means every invocation within the
   * same period computes the SAME `[windowStart, windowEnd)` — required for the snapshot upsert
   * (B2) and the recommendation dedup (B4) to actually collapse repeat runs onto one row/event. */
  private currentWindow(windowDays: number): SnapshotWindow & FinalizeWindow {
    const windowMs = windowDays * DAY_MS
    const start = Math.floor(Date.now() / windowMs) * windowMs
    return { start: new Date(start), end: new Date(start + windowMs) }
  }

  /** Same epoch-alignment rationale as {@link currentWindow}, for the 7-day capacity-gap week that
   * `CapacityGapService`/`emitRecruitment` key off. */
  private currentWeekStart(): Date {
    return new Date(Math.floor(Date.now() / WEEK_MS) * WEEK_MS)
  }

  /** Deterministic per-tenant `pg_try_advisory_xact_lock` key: a signed 64-bit int derived from a
   * SHA-256 of the tenant id (stable across process restarts, no shared counter/registry needed —
   * any two app instances hash the same tenant id to the same key). `BigInt.asIntN(64, ...)` folds
   * the unsigned hash into Postgres's signed `bigint` domain. */
  private advisoryLockKey(tenantId: string): bigint {
    const hash = createHash('sha256').update(tenantId).digest()
    return BigInt.asIntN(64, hash.readBigUInt64BE(0))
  }
}
