import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { TenantClient } from '@hrobot/db'

/**
 * Per-unit (or tenant-default when `unitId` is `null`) `strategic-brain` scoring configuration
 * (spec §14 finding B1, plan Task 4). Structurally mirrors `AiConfigService`
 * (`../ai-grafik/ai-config.service.ts`) — same nullable-default-row P2002-recovery idiom, since
 * `PerformanceConfig` carries the same shape of DB constraint: `@@unique([unitId])` cannot itself
 * protect the single default row (Postgres allows multiple `NULL`s), so a partial unique index
 * (`perf_config_default_unique ON performance_config(unit_id) WHERE unit_id IS NULL`, added by the
 * Task 1 migration) is the real guard, and a concurrent first-write race on that row surfaces as a
 * Prisma P2002 the service must recover from rather than 500 on.
 */

/** The mutable scoring-relevant fields (weights + thresholds), independent of `unitId`/id/audit
 * columns. This is exactly the shape {@link configHash} hashes, and the shape a caller may PATCH
 * via {@link PerformanceConfigService.upsertConfig}. */
export interface PerformanceConfigFields {
  weightPerformance: number
  weightTimeliness: number
  weightQuality: number
  weightDevelopment: number
  slaTargetMinutes: number
  defectThreshold: number
  confidenceMinDays: number
  windowDays: number
  minValidWindows: number
  minSlopeForGrowth: number
  minPeerGroupSize: number
}

/** Prisma's generated `ProactivityLevel` enum values, hand-kept in sync (mirrors how
 * `AutonomyLevel`/`AiProposalState` are hand-mirrored into `@hrobot/shared` for the same reason:
 * `@hrobot/db`'s public surface deliberately does not re-export generated runtime enum objects). */
export const ProactivityLevel = {
  TYLKO_NA_ZADANIE: 'TYLKO_NA_ZADANIE',
  PROAKTYWNE_REKOMENDACJE: 'PROAKTYWNE_REKOMENDACJE',
  PROAKTYWNE_ALERTY: 'PROAKTYWNE_ALERTY',
} as const
export type ProactivityLevel = (typeof ProactivityLevel)[keyof typeof ProactivityLevel]

/** Config projection returned when no row exists yet for the requested scope (mirrors
 * `AiConfigService`'s `DefaultAiConfig` — see {@link PerformanceConfigService.defaultConfig}). */
export interface DefaultPerformanceConfig extends PerformanceConfigFields {
  unitId: string | null
  proactivityLevel: ProactivityLevel
}

/** Input to {@link PerformanceConfigService.upsertConfig} — every scoring field is optional (a
 * PATCH), `unitId` absent/undefined means the tenant-wide default row. */
export type UpsertPerformanceConfigInput = Partial<PerformanceConfigFields> & {
  unitId?: string
  proactivityLevel?: ProactivityLevel
}

const WEIGHT_KEYS = ['weightPerformance', 'weightTimeliness', 'weightQuality', 'weightDevelopment'] as const

/** Floating-point tolerance for the Σweights == 1.00 check — weights arrive as JS numbers (e.g.
 * 0.1 + 0.2 + 0.3 + 0.4 !== 1 exactly under IEEE754), not as exact decimal literals. */
const WEIGHT_SUM_EPSILON = 1e-6

/**
 * Validates that when ANY of the four weight fields is present in a config write, ALL FOUR are
 * present and sum to 1.00 (within {@link WEIGHT_SUM_EPSILON}). A partial weight change (e.g. only
 * `weightPerformance`) is rejected as ambiguous — the caller cannot know what the other three
 * should renormalize to, so the safe behaviour is to require the full set whenever weights change
 * at all. Fields other than the four weights are never touched by this check.
 */
function validateWeightSum(data: Partial<PerformanceConfigFields>): void {
  const provided = WEIGHT_KEYS.filter((k) => data[k] !== undefined)
  if (provided.length === 0) return
  if (provided.length !== WEIGHT_KEYS.length) {
    throw new BadRequestException(
      `Performance config weights must be set all four at once (missing: ${WEIGHT_KEYS.filter((k) => !provided.includes(k)).join(', ')})`,
    )
  }
  const sum = WEIGHT_KEYS.reduce((acc, k) => acc + (data[k] as number), 0)
  if (Math.abs(sum - 1) > WEIGHT_SUM_EPSILON) {
    throw new BadRequestException(
      `Performance config weights (performance+timeliness+quality+development) must sum to 1.00, got ${sum}`,
    )
  }
}

/** True for Prisma's "unique constraint violation" error code, regardless of exact error shape
 * (mirrors the same narrow type-guard idiom used in `ai-config.service.ts` and
 * `employees.service.ts`). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002'
}

/**
 * `configHash` (B2) — a short, deterministic fingerprint of the scoring-relevant fields of a
 * `PerformanceConfig`. Stored on `EmployeePerformanceSnapshot.configHash` so a later reader can
 * tell whether a cached snapshot was computed under the config still in effect, or whether the
 * config has since changed and a recompute would produce different numbers (B2: snapshots are a
 * materialized CACHE, not an audit fact — this hash is the cache-invalidation signal).
 *
 * Pure function: no I/O, no class state. Deterministic w.r.t. VALUES only — key order in the
 * input object never affects the result, because keys are sorted before hashing.
 */
export function configHash(config: PerformanceConfigFields): string {
  const sortedEntries = (Object.keys(config) as (keyof PerformanceConfigFields)[])
    .sort()
    .map((key) => [key, config[key]] as const)
  const json = JSON.stringify(sortedEntries)
  return createHash('sha256').update(json).digest('hex').slice(0, 16)
}

@Injectable()
export class PerformanceConfigService {
  /** The synthetic default a caller sees before any config row has been persisted for `unitId` —
   *  mirrors the Task 1 Prisma schema's `@default(...)` values column-for-column, so a tenant
   *  with zero rows still gets a fully-populated, spec-correct scoring config. */
  private defaultConfig(unitId: string | null): DefaultPerformanceConfig {
    return {
      unitId,
      weightPerformance: 0.3,
      weightTimeliness: 0.25,
      weightQuality: 0.25,
      weightDevelopment: 0.2,
      slaTargetMinutes: 120,
      defectThreshold: 0.1,
      confidenceMinDays: 30,
      windowDays: 14,
      minValidWindows: 3,
      minSlopeForGrowth: 0.5,
      minPeerGroupSize: 5,
      proactivityLevel: ProactivityLevel.PROAKTYWNE_REKOMENDACJE,
    }
  }

  /**
   * Resolve the config that actually applies to `unitId`: the unit's OWN row wins when present;
   * otherwise the tenant-wide default (`unitId = null`) row; otherwise a synthetic schema-default
   * (never 404 — every caller always has a config to read). `unitId: null` goes straight to the
   * global-row lookup, skipping the (pointless) unit lookup entirely — mirrors the fallback shape
   * of `AiConfigService.getEffectiveBudgetCap` (Codex P1-3), not `getConfig`'s single-row read,
   * because this method's contract is an explicit 3-tier fallback.
   */
  async getEffectiveConfig(client: TenantClient, unitId: string | null): Promise<unknown> {
    if (unitId) {
      const unitRow = await client.performanceConfig.findFirst({ where: { unitId } })
      if (unitRow) return unitRow
    }
    const globalRow = await client.performanceConfig.findFirst({ where: { unitId: null } })
    return globalRow ?? this.defaultConfig(unitId)
  }

  /**
   * Create-or-update the config for `input.unitId` (absent = the tenant-wide default row).
   * Validates Σweights == 1.00 up front (see {@link validateWeightSum}) before touching the DB —
   * a rejected write must never partially land.
   *
   * The write is keyed on `@@unique([unitId])` via `upsert` for a real unit; the nullable default
   * row can't be `upsert`-keyed (Prisma's unique-where rejects `null`), so it takes the same
   * explicit find-then-update/create path as `AiConfigService.upsertConfig`
   * (`../ai-grafik/ai-config.service.ts:106-126`): two concurrent first-writes can race, the
   * loser's `create` hits `perf_config_default_unique` and throws P2002 — re-read the
   * now-existing row and update it instead of surfacing a raw 500, and never create a duplicate
   * default.
   */
  async upsertConfig(client: TenantClient, input: UpsertPerformanceConfigInput): Promise<unknown> {
    const { unitId, ...data } = input
    validateWeightSum(data)

    const key = unitId ?? null
    if (key === null) {
      const before = await client.performanceConfig.findFirst({ where: { unitId: null } })
      if (before) {
        return client.performanceConfig.update({ where: { id: before.id }, data })
      }
      try {
        return await client.performanceConfig.create({ data: { ...data, unitId: null } })
      } catch (err: unknown) {
        if (isUniqueViolation(err)) {
          const existing = await client.performanceConfig.findFirst({ where: { unitId: null } })
          if (!existing) throw new ConflictException('Performance config default already exists')
          return client.performanceConfig.update({ where: { id: existing.id }, data })
        }
        throw err
      }
    }

    return client.performanceConfig.upsert({ where: { unitId: key }, update: data, create: { ...data, unitId: key } })
  }
}
