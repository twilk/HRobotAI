import { ForbiddenException, Injectable } from '@nestjs/common'
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
  autonomyLevel: (typeof AutonomyLevel)['SUGGEST_ONLY']
  consentTtlHours: number
  unitId: string | null
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

  /** The synthetic default a caller sees before any config row has been persisted for `unitId`. */
  private defaultConfig(unitId: string | null): DefaultAiConfig {
    return { autonomyLevel: AutonomyLevel.SUGGEST_ONLY, consentTtlHours: 24, unitId }
  }

  /**
   * Read the config for `unitId` (undefined = the tenant-wide default row). A GLOBAL actor (HR/ADMIN)
   * may read any unit; a MANAGER only a unit they manage — anything else (including an undefined unit
   * for a MANAGER, which is never in their managed set) is a 403. When no row exists yet, a synthetic
   * SUGGEST_ONLY default is returned rather than 404.
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
      // key on it — fall back to update-by-id (existing) or create (first write).
      after = before
        ? await client.aiSchedulingConfig.update({ where: { id: before.id }, data })
        : await client.aiSchedulingConfig.create({ data: { ...data, unitId: null } })
    } else {
      after = await client.aiSchedulingConfig.upsert({ where: { unitId: key }, update: data, create: { ...data, unitId: key } })
    }

    // Config carries no PII → before/after snapshots are audited verbatim.
    await this.writeAudit(client, actor, after.id, { before, after })
    return after
  }
}
