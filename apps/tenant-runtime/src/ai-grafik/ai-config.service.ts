import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { AutonomyLevel } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import type { UpdateAiConfigDto } from './dto/ai-config.dto.js'

/** The acting user projected from the JWT + IP (mirrors EmployeeActor/GrafikActor). */
export interface AiConfigActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/** Config projection returned when no row exists yet (mirrors the schema defaults). */
export interface DefaultAiConfig {
  /** (2026-07-14 spec §12 Etap 2) Mirrors the `AiSchedulingConfig.autonomyLevel` column default —
   *  see {@link AiConfigService.defaultConfig}. */
  autonomyLevel: (typeof AutonomyLevel)['AUTO_ASK_CONSENT']
  consentTtlHours: number
  unitId: string | null
  /** (Codex P1-2) No row yet ⇒ no cap has ever been set for this unit. */
  budgetWeeklyCap: null
  /** Cross-unit replacement travel policy (2026-07-14 spec) — mirrors the schema column defaults so
   *  the engine always has a policy to read, even before any config row has ever been written. */
  avgSpeedKmh: number
  perKmRatePln: number
  maxTravelMinutes: number
  roundTrip: boolean
}

/** Which config row (if any) an effective budget cap was resolved from. */
export type BudgetCapSource = 'unit' | 'global' | 'none'

/** The effective weekly budget cap for a unit (or the tenant-wide view when `unitId` is `null`). */
export interface EffectiveBudgetCap {
  /** `null` when neither the unit nor the global row has a cap set ("brak capu"). */
  cap: string | null
  source: BudgetCapSource
}

/**
 * AI-scheduling ("Grafik AI") per-unit configuration (Task 0.3). One `AiSchedulingConfig` row per
 * `unitId` (a `null` unit is the tenant-wide default — schema `@@unique([unitId])`). RBAC mirrors
 * the employees module: HR/ADMIN_KLIENTA act across every unit (`isGlobal`), a MANAGER only on the
 * unit(s) they manage (`managedUnitIds`), and a plain PRACOWNIK never writes config. The config row
 * carries NO PII, so the `before`/`after` audit snapshots are written verbatim.
 */
@Injectable()
export class AiConfigService {
  constructor(private readonly audit: AuditService) {}

  private writeAudit(client: TenantClient, actor: AiConfigActor, id: string, payload: Record<string, unknown>): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action: 'ai_config.updated', entityType: 'AiSchedulingConfig', entityId: id, payload, ipAddress: actor.ipAddress })
  }

  /** The synthetic default a caller sees before any config row has been persisted for `unitId`
   *  (2026-07-14 spec §12 Etap 2: mirrors the schema column default, AUTO_ASK_CONSENT). */
  private defaultConfig(unitId: string | null): DefaultAiConfig {
    return {
      autonomyLevel: AutonomyLevel.AUTO_ASK_CONSENT,
      consentTtlHours: 24,
      unitId,
      budgetWeeklyCap: null,
      avgSpeedKmh: 60,
      perKmRatePln: 1.15,
      maxTravelMinutes: 120,
      roundTrip: true,
    }
  }

  /**
   * Read the config for `unitId` (undefined = the tenant-wide default row). A GLOBAL actor (HR/ADMIN)
   * may read any unit; a MANAGER only a unit they manage — anything else (including an undefined unit
   * for a MANAGER, which is never in their managed set) is a 403. When no row exists yet, a synthetic
   * AUTO_ASK_CONSENT default is returned rather than 404 (2026-07-14 spec §12 Etap 2).
   */
  async getConfig(client: TenantClient, actor: AiConfigActor, unitId?: string): Promise<unknown> {
    if (!isGlobal(actor.roles)) {
      const managed = unitId ? await managedUnitIds(client, actor.userId) : []
      if (!unitId || !managed.includes(unitId)) throw new ForbiddenException('AI config is outside your scope')
    }
    const key = unitId ?? null
    const row = await client.aiSchedulingConfig.findFirst({ where: { unitId: key } })
    return row ?? this.defaultConfig(key)
  }

  /**
   * Create-or-update the config for `dto.unitId` (absent = the tenant-wide default row). HR/ADMIN may
   * write any unit; a MANAGER only a unit they manage; a plain PRACOWNIK (who manages nothing) always
   * gets a 403. The write is keyed on the `@@unique([unitId])` constraint via `upsert` for a real
   * unit; the nullable default row can't be `upsert`-keyed (Prisma unique-where rejects null), so it
   * takes an explicit find-then-update/create path. The pre-write snapshot is captured for the audit.
   */
  async upsertConfig(client: TenantClient, actor: AiConfigActor, dto: UpdateAiConfigDto): Promise<unknown> {
    if (!isGlobal(actor.roles)) {
      const managed = dto.unitId ? await managedUnitIds(client, actor.userId) : []
      if (!dto.unitId || !managed.includes(dto.unitId)) throw new ForbiddenException('Only HR/ADMIN or the managing MANAGER may edit AI config')
    }

    const { unitId, ...data } = dto
    const key = unitId ?? null
    const before = await client.aiSchedulingConfig.findFirst({ where: { unitId: key } })

    let after: { id: string }
    if (key === null) {
      // Nullable default row: `AiSchedulingConfigWhereUniqueInput.unitId` is non-null, so upsert can't
      // key on it — fall back to update-by-id (existing) or create (first write). Two concurrent
      // first-writes can race: the loser's `create` hits the partial unique index
      // (`ai_config_single_default`) and throws P2002 — re-read the now-existing row and update it
      // instead of surfacing a raw 500 (mirrors the P2002 idiom in employees.service.ts).
      if (before) {
        after = await client.aiSchedulingConfig.update({ where: { id: before.id }, data })
      } else {
        try {
          after = await client.aiSchedulingConfig.create({ data: { ...data, unitId: null } })
        } catch (err: unknown) {
          if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
            const existing = await client.aiSchedulingConfig.findFirst({ where: { unitId: null } })
            if (!existing) throw new ConflictException('AI config default already exists')
            after = await client.aiSchedulingConfig.update({ where: { id: existing.id }, data })
          } else {
            throw err
          }
        }
      }
    } else {
      after = await client.aiSchedulingConfig.upsert({ where: { unitId: key }, update: data, create: { ...data, unitId: key } })
    }

    // Config carries no PII → before/after snapshots are audited verbatim.
    await this.writeAudit(client, actor, after.id, { before, after })
    return after
  }

  /**
   * (Codex P1-3) Resolve the weekly budget cap that actually applies to `unitId`: the unit's OWN
   * `AiSchedulingConfig` row wins when it has a cap set; otherwise fall back to the tenant-wide
   * default (the `unitId = null` row); otherwise there is no cap at all. `unitId: null` means the
   * tenant-wide/HR view — it goes straight to the global row. Callers (CostService) MUST use this
   * instead of comparing a unit's cost to the global cap directly, and must not treat a missing row
   * as "cap = 0".
   */
  async getEffectiveBudgetCap(client: TenantClient, unitId: string | null): Promise<EffectiveBudgetCap> {
    if (unitId) {
      const unitRow = await client.aiSchedulingConfig.findFirst({ where: { unitId } })
      if (unitRow?.budgetWeeklyCap != null) return { cap: unitRow.budgetWeeklyCap.toString(), source: 'unit' }
    }
    const globalRow = await client.aiSchedulingConfig.findFirst({ where: { unitId: null } })
    if (globalRow?.budgetWeeklyCap != null) return { cap: globalRow.budgetWeeklyCap.toString(), source: 'global' }
    return { cap: null, source: 'none' }
  }
}
