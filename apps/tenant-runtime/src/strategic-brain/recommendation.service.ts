import { Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import {
  compositeScore,
  developmentSlope,
  normalizeToPeerGroup,
  retentionSignal,
  type RetentionSignal,
  type ScoreWeights,
} from './scoring.util.js'
import { PerformanceConfigService, type PerformanceConfigFields } from './performance-config.service.js'
import { CapacityGapService } from './capacity-gap.service.js'
import { ALGORITHM_VERSION } from './snapshot.service.js'

/**
 * `strategic-brain` window-finalization + recommendation engine (spec §4/§6, §14 findings B2/B3/B4,
 * M8/M9/M10; plan Task 7). The layer that runs AFTER `SnapshotService` has written a partial
 * (timeliness + quality) snapshot per (employee, window):
 *
 *  1. {@link finalizeWindow} completes each window's snapshot — it peer-normalizes throughput into
 *     the `performance` dimension (M10 fallback ladder + small-group confidence penalty), computes
 *     `developmentSlope` from the employee's series of window composites (M9: excluded windows are
 *     SKIPPED, and a series with fewer than `minValidWindows` VALID points yields a `null` slope),
 *     recomputes the FINAL `compositeScore` over all present dimensions (M8 renormalization), and
 *     re-UPSERTs the cache row (B2 overwrite).
 *  2. {@link emitRetention} derives a per-employee retention SIGNAL from the finalized snapshot. The
 *     snapshot IS the persisted read-model — the signal is a deterministic pure derivation of its
 *     `compositeScore`/`developmentSlope`/`confidence`, so no new table is needed; the returned
 *     `factors` keep the decision explainable.
 *  3. {@link emitRecruitment} computes a `RecruitmentVerdict` from {@link CapacityGapService} plus
 *     quality/timeliness aggregates and writes it as an IMMUTABLE EVENT (B3): a NEW row whose
 *     `replacesRecommendationId` points at the prior head — the old row is NEVER mutated and there
 *     is NO `supersededAt`. Change-detection (B4) suppresses a new event when the verdict and the
 *     material factors are unchanged, so repeated scheduler runs don't spam identical events.
 *  4. {@link currentRecommendation} returns the head of the replaces-chain (newest event per scope).
 */

/** Confidence (0..1) below which retention is forced to `OBSERWOWAC` — the scoring config carries
 * `confidenceMinDays` (a tenure floor in days) but no 0..1 threshold, so this is the module-level
 * cutoff mirrored from the spec's retention test cfg (`confidenceMin: 0.5`). */
export const RETENTION_CONFIDENCE_MIN = 0.5

/** Minimum aggregate SLA hit-rate a scope must clear to count as "on time"; below it, timeliness is
 * flagged below-target for the recruitment verdict. */
export const SLA_TARGET_HIT_RATE = 0.8

/** Confidence multiplier applied once when peer normalization had to fall back BELOW the finest
 * (`position|unitId|etat`) grouping level (M10). */
export const PEER_FALLBACK_CONFIDENCE_PENALTY = 0.85

/** Additional confidence multiplier when even the chosen (coarsest available) peer group is smaller
 * than `minPeerGroupSize` — the normalization is only indicative (M10). */
export const PEER_NOT_MEANINGFUL_CONFIDENCE_PENALTY = 0.7

export type RecoScope = { scopeType: 'LOKALIZACJA' | 'UNIT'; scopeId: string }

export interface RetentionResult {
  employeeId: string
  signal: RetentionSignal
  factors: {
    compositeScore: number | null
    developmentSlope: number | null
    confidence: number
    slaHitRate: number | null
    defectRate: number | null
    throughput: number
    isNewHire: boolean
    excludedReason: string | null
  }
}

/** Minimal shape of a snapshot row this service reads (numbers stand in for Prisma Decimals). */
interface SnapshotRow {
  id: string
  employeeId: string
  windowStart: Date
  windowEnd: Date
  throughput: number
  slaHitRate: number | null
  defectRate: number | null
  compositeScore: number | null
  developmentSlope: number | null
  confidence: number
  peerGroupKey: string
  isNewHire: boolean
  excludedReason: string | null
}

export interface FinalizeWindow {
  start: Date
  end: Date
}

/** Split a `position|unitId|etat` peer key into its M10 fallback-ladder levels (finest → coarsest,
 * global last). */
function fallbackKeys(peerGroupKey: string): string[] {
  const [position = '', unitId = ''] = peerGroupKey.split('|')
  return [peerGroupKey, `${position}|${unitId}`, position, '__GLOBAL__']
}

function num(v: number | null | undefined): number | null {
  return v == null ? null : Number(v)
}

@Injectable()
export class RecommendationService {
  constructor(
    private readonly configService: PerformanceConfigService,
    private readonly capacityGapService: CapacityGapService,
  ) {}

  /**
   * Complete every snapshot of `window`: performance dim (peer-normalized throughput, M10),
   * developmentSlope (M9), final composite (M8), and a re-upsert (B2). Reads all snapshots up to
   * `window.end` in one query so both the peer group (current window) and the trend series (prior
   * windows) are available without a per-employee round-trip.
   */
  async finalizeWindow(client: TenantClient, window: FinalizeWindow): Promise<void> {
    const cfg = await this.resolveConfig(client)
    const weights: ScoreWeights = {
      performance: cfg.weightPerformance,
      timeliness: cfg.weightTimeliness,
      quality: cfg.weightQuality,
      development: cfg.weightDevelopment,
    }

    const all = (await client.employeePerformanceSnapshot.findMany({
      where: { windowEnd: { lte: window.end } },
      orderBy: { windowEnd: 'asc' },
    })) as unknown as SnapshotRow[]

    const current = all.filter(
      (s) => s.windowStart.getTime() === window.start.getTime() && s.windowEnd.getTime() === window.end.getTime(),
    )

    // Peer-group throughput index for the CURRENT window, keyed at every fallback level (M10).
    const throughputByLevel = new Map<string, number[]>()
    for (const s of current) {
      for (const key of fallbackKeys(s.peerGroupKey)) {
        const arr = throughputByLevel.get(key) ?? []
        arr.push(s.throughput)
        throughputByLevel.set(key, arr)
      }
    }

    for (const s of current) {
      // --- performance dim via the M10 fallback ladder ------------------------------------------
      const levels = fallbackKeys(s.peerGroupKey)
      let chosenPeers: number[] = []
      let fellBack = false
      let meaningful = false
      for (let i = 0; i < levels.length; i++) {
        const peers = throughputByLevel.get(levels[i] as string) ?? []
        chosenPeers = peers
        fellBack = i > 0
        if (peers.length >= cfg.minPeerGroupSize) {
          meaningful = true
          break
        }
        // keep widening; if we exhaust the ladder we stay on the global group (not meaningful)
      }
      const norm = normalizeToPeerGroup(s.throughput, chosenPeers, { minPeerGroupSize: cfg.minPeerGroupSize })
      const performanceDim = norm.value

      const timeliness = num(s.slaHitRate)
      const quality = s.defectRate == null ? null : (1 - Number(s.defectRate)) * 100

      // --- provisional composite (perf + timeliness + quality, no development) for the trend point
      const provisional = compositeScore(
        { performance: performanceDim, timeliness: timeliness == null ? null : timeliness * 100, quality, development: null },
        weights,
      )

      // --- developmentSlope from the series of window composites (M9: skip excluded windows) ----
      const priorPoints = all
        .filter(
          (x) => x.employeeId === s.employeeId && x.windowEnd.getTime() < window.end.getTime() && x.excludedReason == null,
        )
        .sort((a, b) => a.windowEnd.getTime() - b.windowEnd.getTime())
        .map((x) => num(x.compositeScore))
        .filter((v): v is number => v != null)

      const series = [...priorPoints]
      if (s.excludedReason == null && provisional != null) series.push(provisional)
      const points = series.map((score, t) => ({ t, score }))
      const slope = developmentSlope(points, cfg.minValidWindows)

      const developmentDim = slope == null ? null : this.slopeToDevelopmentScore(slope, cfg.minSlopeForGrowth)

      // --- FINAL composite over all present dims (M8) -------------------------------------------
      const finalComposite = compositeScore(
        {
          performance: performanceDim,
          timeliness: timeliness == null ? null : timeliness * 100,
          quality,
          development: developmentDim,
        },
        weights,
      )

      // --- confidence penalty for coarse / not-meaningful normalization (M10) -------------------
      let confidence = Number(s.confidence)
      if (fellBack) confidence *= PEER_FALLBACK_CONFIDENCE_PENALTY
      if (!meaningful) confidence *= PEER_NOT_MEANINGFUL_CONFIDENCE_PENALTY

      await client.employeePerformanceSnapshot.upsert({
        where: {
          employeeId_windowStart_windowEnd: {
            employeeId: s.employeeId,
            windowStart: window.start,
            windowEnd: window.end,
          },
        },
        update: { compositeScore: finalComposite, developmentSlope: slope, confidence, algorithmVersion: ALGORITHM_VERSION },
        create: {
          employeeId: s.employeeId,
          windowStart: window.start,
          windowEnd: window.end,
          compositeScore: finalComposite,
          developmentSlope: slope,
          confidence,
          algorithmVersion: ALGORITHM_VERSION,
        },
      } as never)
    }
  }

  /**
   * Map a raw slope (composite-points per window) to a bounded 0..100 development dimension. Flat
   * (slope 0) is neutral (50); a slope of `minSlopeForGrowth` reaches 75 and `2×minSlopeForGrowth`
   * saturates at 100 (symmetric on the downside). Deterministic and monotonic — the exact curve is
   * a demo policy, kept bounded so the development dimension can never dominate the composite.
   */
  private slopeToDevelopmentScore(slope: number, minSlopeForGrowth: number): number {
    const span = minSlopeForGrowth > 0 ? minSlopeForGrowth : 0.5
    const raw = 50 + (slope / span) * 25
    return Math.max(0, Math.min(100, raw))
  }

  /**
   * Per-employee retention signal for `window`, derived purely from the finalized snapshot (the
   * persisted read-model). Low confidence or a null trend both resolve to `OBSERWOWAC` inside
   * {@link retentionSignal}; a null composite (too little data for a score at all) is likewise
   * `OBSERWOWAC`. `factors` keeps the decision explainable (the dims + slope + confidence).
   */
  async emitRetention(client: TenantClient, window: FinalizeWindow): Promise<RetentionResult[]> {
    const cfg = await this.resolveConfig(client)
    const rows = (await client.employeePerformanceSnapshot.findMany({
      where: { windowStart: window.start, windowEnd: window.end },
    })) as unknown as SnapshotRow[]

    const retentionCfg = { minSlopeForGrowth: cfg.minSlopeForGrowth, confidenceMin: RETENTION_CONFIDENCE_MIN }

    return rows.map((s) => {
      const composite = num(s.compositeScore)
      const slope = num(s.developmentSlope)
      const confidence = Number(s.confidence)
      const signal: RetentionSignal =
        composite == null ? 'OBSERWOWAC' : retentionSignal(composite, slope, confidence, retentionCfg)
      return {
        employeeId: s.employeeId,
        signal,
        factors: {
          compositeScore: composite,
          developmentSlope: slope,
          confidence,
          slaHitRate: num(s.slaHitRate),
          defectRate: num(s.defectRate),
          throughput: s.throughput,
          isNewHire: s.isNewHire,
          excludedReason: s.excludedReason,
        },
      }
    })
  }

  /**
   * [READ, M16] The CURRENT (head) recommendation per scope for `/strategic-brain/recruitment`,
   * optionally filtered to a MANAGER's `scopeIds`. "Current" = the newest event per `(scopeType,
   * scopeId)` (B3 — recency, not a `supersededAt` flag). `scopeIds === null` = a GLOBAL actor
   * (HR/ADMIN, every scope); a non-null array keeps only recommendations whose `scopeId` is in it
   * (an empty array ⇒ zero rows, never a bypass).
   *
   * Demo limitation (documented): recommendations are emitted at `LOKALIZACJA` scope while a MANAGER's
   * `managedUnitIds` are UNIT ids; the filter is a pure `scopeId ∈ scopeIds` membership test, so a
   * manager sees a recommendation only where a location id coincides with a managed unit id. The
   * location↔unit mapping is a seed/data concern (Faza 2/3), not this HTTP-layer task — the
   * enforcement PRIMITIVE (service-level scope filter) is what M16 requires and is in place here.
   */
  async listRecruitment(client: TenantClient, scopeIds: string[] | null): Promise<unknown[]> {
    const rows = (await client.recruitmentRecommendation.findMany({
      orderBy: { computedAt: 'desc' },
    })) as Array<{ scopeType: string; scopeId: string } & Record<string, unknown>>

    const head = new Map<string, (typeof rows)[number]>()
    for (const r of rows) {
      const key = `${r.scopeType}|${r.scopeId}`
      if (!head.has(key)) head.set(key, r) // rows are computedAt-desc, first per scope is the head
    }
    let list = [...head.values()]
    if (scopeIds !== null) list = list.filter((r) => scopeIds.includes(r.scopeId))
    return list
  }

  /**
   * [WRITE — OWN TABLE ONLY, M13] Record a human's acknowledgement of a recommendation: stamp
   * `acknowledgedByUserId` / `acknowledgedAt` on the `RecruitmentRecommendation` row itself. This is
   * the ONLY mutation the acknowledge flow performs — it does NOT touch `Employee`/`Shift`/any
   * personnel-execution state (RODO art. 22: the AI recommends, a human decides, and the decision is
   * merely logged, never auto-actioned). The ids-only AUDIT entry is written by the controller (M19).
   */
  async acknowledge(client: TenantClient, id: string, userId: string): Promise<unknown> {
    return client.recruitmentRecommendation.update({
      where: { id },
      data: { acknowledgedByUserId: userId, acknowledgedAt: new Date() },
    } as never)
  }

  /**
   * The current (head) recommendation for `scope` — the newest event, i.e. the head of the
   * replaces-chain. "Current" is defined by recency (B3), NOT by a `supersededAt` flag.
   */
  async currentRecommendation(client: TenantClient, scope: RecoScope): Promise<unknown> {
    return client.recruitmentRecommendation.findFirst({
      where: { scopeType: scope.scopeType, scopeId: scope.scopeId },
      orderBy: { computedAt: 'desc' },
    })
  }

  /**
   * Compute and (if changed) EMIT a recruitment recommendation for `scope`/`weekStart`. Verdict:
   *  - `WZNOW` (resume) — there is a capacity gap (`totalGap > 0`).
   *  - `WSTRZYMAJ` (halt) — fully covered / overstaffed (`totalGap <= 0`) AND operationally healthy.
   *  - `UTRZYMAJ` (maintain) — covered but quality/timeliness below target (address without headcount).
   *
   * B3: writes a NEW immutable event with `replacesRecommendationId = current?.id` and a FROZEN
   * `factors` JSON. B4: if the current head already has the same verdict AND the same material
   * factors, no new event is written (returns the existing head) — repeated runs don't spam.
   */
  async emitRecruitment(client: TenantClient, scope: RecoScope, weekStart: Date): Promise<{ id?: string; verdict: string; [k: string]: unknown }> {
    const cfg = await this.resolveConfig(client)
    const gap = await this.capacityGapService.capacityGap(client, scope.scopeId, weekStart)

    // Operational-health aggregates over recent, non-excluded snapshots (scope-level proxy; snapshots
    // are not location-tagged, documented demo limitation).
    const snaps = (await client.employeePerformanceSnapshot.findMany({
      where: { excludedReason: null },
      orderBy: { windowEnd: 'desc' },
    })) as unknown as SnapshotRow[]
    const defects = snaps.map((s) => num(s.defectRate)).filter((v): v is number => v != null)
    const slas = snaps.map((s) => num(s.slaHitRate)).filter((v): v is number => v != null)
    const avgDefectRate = defects.length ? defects.reduce((a, b) => a + b, 0) / defects.length : null
    const avgSlaHitRate = slas.length ? slas.reduce((a, b) => a + b, 0) / slas.length : null

    const qualityBelowTarget = avgDefectRate != null && avgDefectRate > cfg.defectThreshold
    const timelinessBelowTarget = avgSlaHitRate != null && avgSlaHitRate < SLA_TARGET_HIT_RATE
    const belowTarget = qualityBelowTarget || timelinessBelowTarget

    let verdict: 'WZNOW' | 'WSTRZYMAJ' | 'UTRZYMAJ'
    if (gap.totalGap > 0) verdict = 'WZNOW'
    else if (!belowTarget) verdict = 'WSTRZYMAJ'
    else verdict = 'UTRZYMAJ'

    const factors = {
      totalGap: gap.totalGap,
      byRole: gap.byRole,
      avgDefectRate,
      avgSlaHitRate,
      defectThreshold: cfg.defectThreshold,
      slaTargetRate: SLA_TARGET_HIT_RATE,
      qualityBelowTarget,
      timelinessBelowTarget,
      employeeCount: snaps.length,
      weekStart: weekStart.toISOString(),
    }

    const current = (await this.currentRecommendation(client, scope)) as
      | { id: string; verdict: string; factors?: Record<string, unknown> }
      | null

    // [B4] change-detection: identical verdict + material factors ⇒ no new event.
    if (current && this.isUnchanged(current, verdict, factors)) {
      return current as { id?: string; verdict: string }
    }

    const rationale = this.buildRationale(verdict, factors)

    return (await client.recruitmentRecommendation.create({
      data: {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        verdict,
        rationale,
        factors,
        replacesRecommendationId: current?.id ?? null,
      },
    } as never)) as { id?: string; verdict: string }
  }

  /** Two recommendations are materially the same when verdict AND the decision-driving factors
   * (capacity gap + the two below-target flags) are equal — cosmetic factor drift (e.g. a tiny
   * average shift that doesn't move a flag) does NOT force a new event (B4). */
  private isUnchanged(
    current: { verdict: string; factors?: Record<string, unknown> },
    verdict: string,
    factors: { totalGap: number; qualityBelowTarget: boolean; timelinessBelowTarget: boolean },
  ): boolean {
    if (current.verdict !== verdict) return false
    const f = current.factors ?? {}
    return (
      f.totalGap === factors.totalGap &&
      f.qualityBelowTarget === factors.qualityBelowTarget &&
      f.timelinessBelowTarget === factors.timelinessBelowTarget
    )
  }

  private buildRationale(verdict: string, factors: { totalGap: number; qualityBelowTarget: boolean; timelinessBelowTarget: boolean }): string {
    if (verdict === 'WZNOW') return `Luka kadrowa wg zapotrzebowania grafiku: ${factors.totalGap}. Zalecane wznowienie rekrutacji.`
    if (verdict === 'WSTRZYMAJ') return `Obsada pokryta (luka ${factors.totalGap}) i metryki w normie. Zalecane wstrzymanie rekrutacji.`
    const issues = [factors.qualityBelowTarget ? 'jakość' : null, factors.timelinessBelowTarget ? 'terminowość' : null]
      .filter(Boolean)
      .join(' + ')
    return `Obsada pokryta, ale poniżej celu (${issues}). Utrzymać stan, poprawić proces bez zwiększania obsady.`
  }

  /** Project the effective (tenant-default) config to plain numbers for finalize/retention/recruitment. */
  private async resolveConfig(client: TenantClient): Promise<PerformanceConfigFields> {
    const cfg = (await this.configService.getEffectiveConfig(client, null)) as Record<string, unknown>
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
