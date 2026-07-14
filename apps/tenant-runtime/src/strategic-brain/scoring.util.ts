/**
 * `strategic-brain` scoring core — PURE functions only. No Prisma, no I/O, no external
 * dependencies (the linear regression used by {@link developmentSlope} is hand-rolled).
 *
 * Null-policy is the load-bearing part of this module (spec §4/§14, plan Task 2):
 *  - [M7] `defectRate` enforces a minimum denominator — "no completed work" is MISSING DATA
 *    (null), not a perfect (0) or undefined defect rate.
 *  - [M8] `compositeScore` renormalizes weights over whatever dimensions are present; below 2
 *    present dimensions the composite is deterministically `null` rather than a misleadingly
 *    confident number built from a single signal.
 *  - [M9] `developmentSlope` is `null` below `minValidWindows` — a null trend is NOT the same as
 *    a flat (≈0) trend, and {@link retentionSignal} must never fold "not enough data yet" into
 *    "RYZYKO" (risk). It always resolves to `OBSERWOWAC` (keep watching / collect more data).
 */

// ---------------------------------------------------------------------------------------------
// Thresholds & constants — pulled out so the "why 50?" / "why 10?" questions have one home.
// ---------------------------------------------------------------------------------------------

/** compositeScore/retentionSignal operate on a 0..100 scale; this is the level cutoff between
 * "low" (needs investment or is at risk) and "high" (worth retaining) performance. */
const RETENTION_SCORE_THRESHOLD = 50

/** Sample-size (`sampleN`) at which {@link confidence} saturates the sample-size factor to 1. */
const CONFIDENCE_SAMPLE_N_TARGET = 20

/** Minimum number of present dimensions for {@link compositeScore} to return a value (M8). */
const COMPOSITE_MIN_PRESENT_DIMENSIONS = 2

// ---------------------------------------------------------------------------------------------
// medianCycleMinutes
// ---------------------------------------------------------------------------------------------

/**
 * Median of `cycleMinutes` across completed work items. `null` when there is nothing completed —
 * "no work yet" must not be silently read as a cycle time of 0.
 */
export function medianCycleMinutes(completed: { cycleMinutes: number }[]): number | null {
  if (completed.length === 0) return null
  const sorted = completed.map((c) => c.cycleMinutes).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] as number
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

// ---------------------------------------------------------------------------------------------
// defectRate
// ---------------------------------------------------------------------------------------------

/**
 * Complaints per completed item. [M7] `null` when `completedCount < 1` (minimum denominator) —
 * "no completed work" is missing data, not a defect rate of 0 or of `complaintCount`.
 */
export function defectRate(complaintCount: number, completedCount: number): number | null {
  if (completedCount < 1) return null
  return complaintCount / completedCount
}

// ---------------------------------------------------------------------------------------------
// slaHitRate
// ---------------------------------------------------------------------------------------------

/**
 * Fraction of completed items that finished within `slaTargetMinutes` (finishing exactly at the
 * target counts as a hit — `cycleMinutes <= slaTargetMinutes`). `null` when there is nothing
 * completed.
 */
export function slaHitRate(completed: { cycleMinutes: number }[], slaTargetMinutes: number): number | null {
  if (completed.length === 0) return null
  const hits = completed.filter((c) => c.cycleMinutes <= slaTargetMinutes).length
  return hits / completed.length
}

// ---------------------------------------------------------------------------------------------
// compositeScore
// ---------------------------------------------------------------------------------------------

export type ScoreDimensions = {
  performance: number | null
  timeliness: number | null
  quality: number | null
  development: number | null
}

export type ScoreWeights = {
  performance: number
  timeliness: number
  quality: number
  development: number
}

/**
 * Weighted composite of the 4 scoring dimensions. [M8] null-policy: a missing dimension is
 * excluded and the remaining weights are RENORMALIZED to sum to 1 over the present dimensions
 * (deterministic — no randomness, no dependency on call order). Below
 * {@link COMPOSITE_MIN_PRESENT_DIMENSIONS} present dimensions, or if the present dimensions'
 * weights sum to 0 (nothing to renormalize against), the composite is `null` rather than a
 * number built on too little signal.
 */
export function compositeScore(dims: ScoreDimensions, weights: ScoreWeights): number | null {
  const keys = (Object.keys(dims) as (keyof ScoreDimensions)[]).filter((k) => dims[k] !== null)
  if (keys.length < COMPOSITE_MIN_PRESENT_DIMENSIONS) return null

  const presentWeightSum = keys.reduce((sum, k) => sum + weights[k], 0)
  if (presentWeightSum <= 0) return null

  const weightedSum = keys.reduce((sum, k) => sum + (dims[k] as number) * weights[k], 0)
  return weightedSum / presentWeightSum
}

// ---------------------------------------------------------------------------------------------
// developmentSlope
// ---------------------------------------------------------------------------------------------

/**
 * Slope of an ordinary-least-squares linear regression of `score` over `t`. [M9] `null` when
 * `series.length < minValidWindows` — too few windows to trust a trend at all, distinct from a
 * trend that IS trustworthy and happens to be flat (slope ≈ 0). Positive slope = rising series.
 */
export function developmentSlope(series: { t: number; score: number }[], minValidWindows: number): number | null {
  if (series.length < minValidWindows) return null

  const n = series.length
  const meanT = series.reduce((sum, p) => sum + p.t, 0) / n
  const meanScore = series.reduce((sum, p) => sum + p.score, 0) / n

  let numerator = 0
  let denominator = 0
  for (const p of series) {
    const dt = p.t - meanT
    numerator += dt * (p.score - meanScore)
    denominator += dt * dt
  }

  if (denominator === 0) return 0 // all points share the same `t` — no trend information
  return numerator / denominator
}

// ---------------------------------------------------------------------------------------------
// confidence
// ---------------------------------------------------------------------------------------------

/**
 * Confidence (0..1) that the score/trend for this employee is trustworthy. Rises with BOTH
 * sample size and tenure — multiplicative, not averaged, so that a small sample stays low
 * confidence even for a long-tenured employee (and vice versa): "we don't have enough
 * observations yet" should never be masked by "but they've been here a while".
 */
export function confidence(sampleN: number, daysEmployed: number, minDays: number): number {
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
  const sampleFactor = clamp01(sampleN / CONFIDENCE_SAMPLE_N_TARGET)
  const tenureFactor = minDays > 0 ? clamp01(daysEmployed / minDays) : clamp01(daysEmployed > 0 ? 1 : 0)
  return clamp01(sampleFactor * tenureFactor)
}

// ---------------------------------------------------------------------------------------------
// retentionSignal
// ---------------------------------------------------------------------------------------------

export type RetentionSignal = 'UTRZYMAC' | 'OBSERWOWAC' | 'RYZYKO' | 'INWESTOWAC'

export type RetentionConfig = {
  minSlopeForGrowth: number
  confidenceMin: number
}

/**
 * Level-vs-trend retention signal — the core of the module.
 *  - Low confidence (below `cfg.confidenceMin`) always resolves to `OBSERWOWAC`: don't punish an
 *    employee (with a risk/investment label) just because we don't have enough data yet.
 *  - [M9] A `null` slope (not enough valid windows) always resolves to `OBSERWOWAC`, never
 *    `RYZYKO` — "unknown trend" must stay visibly distinct from "known-declining trend".
 *  - Otherwise: score < {@link RETENTION_SCORE_THRESHOLD} (low) + slope strictly greater than
 *    `cfg.minSlopeForGrowth` (rising) ⇒ `INWESTOWAC` (weak-but-rising, worth investing in); low
 *    score without that rise (flat or declining) ⇒ `RYZYKO`. score >= threshold (high) + negative
 *    slope (declining) ⇒ `RYZYKO` (good-but-declining); high score with non-negative slope ⇒
 *    `UTRZYMAC`.
 */
export function retentionSignal(
  score: number,
  slope: number | null,
  confidenceValue: number,
  cfg: RetentionConfig,
): RetentionSignal {
  if (confidenceValue < cfg.confidenceMin) return 'OBSERWOWAC'
  if (slope === null) return 'OBSERWOWAC'

  const isHighScore = score >= RETENTION_SCORE_THRESHOLD
  const isRising = slope > cfg.minSlopeForGrowth
  const isDeclining = slope < 0

  if (!isHighScore) {
    return isRising ? 'INWESTOWAC' : 'RYZYKO'
  }
  return isDeclining ? 'RYZYKO' : 'UTRZYMAC'
}
