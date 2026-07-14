import { Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import {
  medianCycleMinutes,
  defectRate,
  compositeScore,
  confidence,
  type ScoreDimensions,
  type ScoreWeights,
} from './scoring.util.js'
import { buildScoringInput } from './scoring-input.js'
import {
  PerformanceConfigService,
  configHash,
  type PerformanceConfigFields,
} from './performance-config.service.js'

/**
 * `strategic-brain` snapshot cache (spec §3.3, §14 findings B2 / M6-M7 / M12; plan Task 6).
 *
 * The integrative layer that turns raw `WorkOrder`/`Complaint`/`LeaveRequest` rows into ONE
 * `EmployeePerformanceSnapshot` per (employee, window). Everything downstream (trajectory,
 * recommendations) reads this materialized cache, never the raw operational tables.
 *
 * Load-bearing invariants:
 *  - [B2] A snapshot is a CACHE, not an audit fact: writes go through `upsert` keyed on
 *    `[employeeId, windowStart, windowEnd]`, so recomputing a window deliberately OVERWRITES it
 *    (idempotent). `algorithmVersion` + `configHash` record which engine/config produced the row.
 *  - [M6/M7] `CANCELLED` work is excluded entirely (never punish an operator-cancelled task).
 *    Throughput + cycle time come from `DONE` rows; timeliness uses the per-order persisted `dueAt`
 *    (`completedAt <= dueAt`); the quality denominator is the `DONE` count (`defectRate` returns
 *    null below a denominator of 1). "No work in window" is MISSING DATA (null metrics, low
 *    confidence) — never a zero-punished score.
 *  - [M11] Fairness: every operational metric is funneled through {@link buildScoringInput}'s
 *    closed allowlist before it can influence scoring, so no PII/proxy can enter the scorer.
 *  - [M12] `excludedReason` is DERIVED from structural data (LeaveRequest date-overlap → a
 *    documented type→category map; onboarding from `hiredAt`), never string-guessed. This is what
 *    lets Task 7's trajectory SKIP L4/onboarding windows so a return-from-sick-leave window never
 *    drags the trend down.
 *
 * This service does NOT compute `developmentSlope` — that needs the multi-window series and is done
 * in Task 7; it is stored `null` here.
 */

/** Scoring-engine version stamped on every cached row (B2). Bump when the computation changes so a
 * reader can tell a stale cache row from a freshly-recomputed one. */
export const ALGORITHM_VERSION = 1

/** Structural exclusion categories written to `EmployeePerformanceSnapshot.excludedReason`. A
 * window carrying any of these is skipped by the trajectory regression (Task 7) rather than
 * silently lowering the trend. `null` means "no exclusion — a normal, counted window". */
export type ExclusionCategory = 'L4' | 'URLOP' | 'ONBOARDING'

/**
 * [M12] Documented map from a free-form `LeaveRequest.type` to a structural exclusion category.
 * Matching is case-insensitive substring — the real `type` values are free text
 * (e.g. `URLOP_WYPOCZYNKOWY`, `URLOP_NA_ZADANIE`, `L4`, `zwolnienie chorobowe`), so we key off the
 * recognizable stem, not an exact enum. Order matters: sickness ("l4"/"chorob") is checked before
 * vacation. A leave whose type matches NOTHING here does NOT exclude the window — we only remove a
 * window from the trend for a recognized, documented reason (fail-safe: unknown ≠ silent exclusion).
 */
const LEAVE_TYPE_EXCLUSION_MAP: ReadonlyArray<{ contains: string; category: Extract<ExclusionCategory, 'L4' | 'URLOP'> }> = [
  { contains: 'l4', category: 'L4' },
  { contains: 'chorob', category: 'L4' }, // "zwolnienie chorobowe" (sick leave)
  { contains: 'urlop', category: 'URLOP' },
]

function mapLeaveTypeToExclusion(type: string): Extract<ExclusionCategory, 'L4' | 'URLOP'> | null {
  const t = type.toLowerCase()
  for (const entry of LEAVE_TYPE_EXCLUSION_MAP) {
    if (t.includes(entry.contains)) return entry.category
  }
  return null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

/** The shape SnapshotService reads off an `Employee` row (subset — no PII touches the scorer). */
interface EmployeeShape {
  hiredAt: Date
  position: string
  unitId: string
  etat: unknown
}

/** The shape SnapshotService reads off a `WorkOrder` row. */
interface WorkOrderShape {
  status: string
  assignedAt: Date
  dueAt: Date
  completedAt: Date | null
}

/** The shape SnapshotService reads off a `LeaveRequest` row (only structural date/type/status). */
interface LeaveShape {
  type: string
  startDate: Date
  endDate: Date
}

export interface SnapshotWindow {
  start: Date
  end: Date
}

@Injectable()
export class SnapshotService {
  constructor(private readonly configService: PerformanceConfigService) {}

  /**
   * Compute (and idempotently upsert) the performance snapshot for `employeeId` over `window`.
   * Returns the persisted row. Recomputing the same window overwrites it (B2).
   */
  async computeSnapshot(client: TenantClient, employeeId: string, window: SnapshotWindow): Promise<unknown> {
    const employee = (await client.employee.findUnique({ where: { id: employeeId } })) as EmployeeShape | null
    if (!employee) throw new Error(`SnapshotService: employee ${employeeId} not found`)

    const config = await this.resolveConfigFields(client, employee.unitId)

    // --- Load operational rows --------------------------------------------------------------
    // WorkOrders assigned in the window, CANCELLED excluded at the query (M6/M7).
    const orders = (await client.workOrder.findMany({
      where: {
        assignedToEmployeeId: employeeId,
        assignedAt: { gte: window.start, lt: window.end },
        status: { not: 'CANCELLED' },
      },
    })) as WorkOrderShape[]
    const complaints = await client.complaint.findMany({
      where: { employeeId, createdAt: { gte: window.start, lt: window.end } },
    })
    // Only overlapping APPROVED leaves count as a real absence (a PENDING/REJECTED request never
    // removes a window from the trend). Date-range overlap: leave.start <= window.end AND
    // leave.end >= window.start.
    const leaves = (await client.leaveRequest.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: window.end },
        endDate: { gte: window.start },
      },
    })) as LeaveShape[]

    // --- Derive per-order metrics (DONE-only) -----------------------------------------------
    const done = orders.filter((o) => o.status === 'DONE' && o.completedAt != null)
    const cycleMinutes = done.map((o) => (o.completedAt!.getTime() - o.assignedAt.getTime()) / MS_PER_MINUTE)
    const slaHits = done.filter((o) => o.completedAt!.getTime() <= o.dueAt.getTime()).length
    const completedCount = done.length

    const peerGroupKey = this.buildPeerGroupKey(employee)

    // [M11] Funnel EVERY operational signal through the closed allowlist before scoring — anything
    // unexpected hard-errors here rather than silently reaching the scorer.
    const input = buildScoringInput({
      throughput: completedCount,
      completedCount,
      complaintCount: complaints.length,
      cycleMinutes,
      slaHits,
      peerGroupKey,
      hiredAt: employee.hiredAt,
    })

    // --- Metrics from the allowlisted input --------------------------------------------------
    const cyc = (input.cycleMinutes as unknown as number[]) ?? []
    const median = medianCycleMinutes(cyc.map((m) => ({ cycleMinutes: m })))
    const defect = defectRate(input.complaintCount ?? 0, input.completedCount ?? 0)
    const sla = completedCount > 0 ? (input.slaHits ?? 0) / completedCount : null

    // Dimensions on a 0..100 scale. Only the two peer-independent, single-window dimensions are
    // computable here: timeliness (SLA hit-rate) and quality (inverse defect-rate). Performance
    // (peer-normalized throughput) and development (multi-window slope) are deferred to the
    // trajectory pass (Task 7) and left null — the composite renormalizes over what is present (M8).
    const dims: ScoreDimensions = {
      performance: null,
      timeliness: sla != null ? sla * 100 : null,
      quality: defect != null ? (1 - defect) * 100 : null,
      development: null,
    }
    const weights: ScoreWeights = {
      performance: config.weightPerformance,
      timeliness: config.weightTimeliness,
      quality: config.weightQuality,
      development: config.weightDevelopment,
    }
    const composite = compositeScore(dims, weights)

    // --- Confidence + onboarding flag --------------------------------------------------------
    const daysEmployed = Math.max(0, Math.floor((window.end.getTime() - employee.hiredAt.getTime()) / MS_PER_DAY))
    const conf = confidence(completedCount, daysEmployed, config.confidenceMinDays)
    // isNewHire: hiredAt within confidenceMinDays of the window end.
    const isNewHire = daysEmployed < config.confidenceMinDays

    const excludedReason = this.deriveExclusion(leaves, employee.hiredAt, window, config.confidenceMinDays)

    // --- Upsert (B2 idempotency) -------------------------------------------------------------
    const data = {
      throughput: completedCount,
      medianCycleMinutes: median == null ? null : Math.round(median),
      slaHitRate: sla,
      defectRate: defect,
      compositeScore: composite,
      developmentSlope: null, // needs the multi-window series — computed in Task 7
      confidence: conf,
      peerGroupKey,
      isNewHire,
      excludedReason,
      algorithmVersion: ALGORITHM_VERSION,
      configHash: configHash(config),
    }

    return client.employeePerformanceSnapshot.upsert({
      where: {
        employeeId_windowStart_windowEnd: {
          employeeId,
          windowStart: window.start,
          windowEnd: window.end,
        },
      },
      update: data,
      create: { employeeId, windowStart: window.start, windowEnd: window.end, ...data },
    })
  }

  /** peerGroupKey = `role|unit|etat` (spec §3.3). `Employee` has no direct `lokalizacjaId`
   * (lokalizacja is a per-shift/per-workorder attribute), so `unitId` is the employee's stable
   * structural locus. Task 7's peer normalization applies the M10 fallback ladder to this key. */
  private buildPeerGroupKey(employee: EmployeeShape): string {
    return `${employee.position}|${employee.unitId}|${String(employee.etat)}`
  }

  /**
   * [M12] Structural exclusion: an overlapping recognized leave wins (more specific than
   * onboarding), otherwise a window inside the onboarding period `[hiredAt, hiredAt +
   * confidenceMinDays)` is ONBOARDING; otherwise `null`.
   */
  private deriveExclusion(
    leaves: LeaveShape[],
    hiredAt: Date,
    window: SnapshotWindow,
    confidenceMinDays: number,
  ): ExclusionCategory | null {
    for (const leave of leaves) {
      const category = mapLeaveTypeToExclusion(leave.type)
      if (category) return category
    }
    const onboardingEnd = new Date(hiredAt.getTime() + confidenceMinDays * MS_PER_DAY)
    // Window overlaps the onboarding period.
    if (window.start.getTime() < onboardingEnd.getTime() && window.end.getTime() > hiredAt.getTime()) {
      return 'ONBOARDING'
    }
    return null
  }

  /** Resolve the effective config for the employee's unit and project it to exactly the
   * scoring-relevant fields — the same shape {@link configHash} fingerprints (B2). Projecting
   * strips id/audit columns so two rows with identical weights/thresholds hash identically. */
  private async resolveConfigFields(client: TenantClient, unitId: string | null): Promise<PerformanceConfigFields> {
    const cfg = (await this.configService.getEffectiveConfig(client, unitId)) as Record<string, unknown>
    return {
      weightPerformance: Number(cfg.weightPerformance),
      weightTimeliness: Number(cfg.weightTimeliness),
      weightQuality: Number(cfg.weightQuality),
      weightDevelopment: Number(cfg.weightDevelopment),
      slaTargetMinutes: Number(cfg.slaTargetMinutes),
      defectThreshold: Number(cfg.defectThreshold),
      confidenceMinDays: Number(cfg.confidenceMinDays),
      windowDays: Number(cfg.windowDays),
      minValidWindows: Number(cfg.minValidWindows),
      minSlopeForGrowth: Number(cfg.minSlopeForGrowth),
      minPeerGroupSize: Number(cfg.minPeerGroupSize),
    }
  }
}
