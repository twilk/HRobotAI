import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { CreateUnitDto, UpdateCompanyDto, UpdateUnitDto } from './dto/ustawienia.dto.js'

/** The acting user projected from the JWT + IP (mirrors EmployeeActor/AiConfigActor). */
export interface SettingsActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/** The synthetic company settings a caller sees before any singleton row has been persisted. */
export interface DefaultCompanySettings {
  companyName: string
  timezone: string
  region: string
  locale: string
}

/** Org-unit projection returned by `listUnits` — richer than GET /grafik/units {id,name}. */
export interface UnitProjection {
  id: string
  name: string
  parentId: string | null
  managerUserId: string | null
  children: string[]
}

/**
 * USTAWIENIA — tenant-wide company settings + organizational-unit CRUD (M2). Reads (`getCompany`,
 * `listUnits`) are open to MANAGER/HR/ADMIN_KLIENTA; every write is ADMIN_KLIENTA-only (re-checked
 * here, defense-in-depth, on top of the controller `@Roles` gate). Neither `CompanySettings` nor
 * `OrganizationalUnit` carries PII, so the `before`/`after` audit snapshots are written verbatim.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly audit: AuditService) {}

  /** Write-side gate: only the tenant admin may mutate settings or the org tree. */
  private assertAdmin(actor: SettingsActor): void {
    if (!actor.roles.includes(Role.ADMIN_KLIENTA)) {
      throw new ForbiddenException('Only ADMIN_KLIENTA may change company settings or units')
    }
  }

  /**
   * Map the Prisma write errors a unit create/update can hit onto clean 4xx responses instead of raw
   * 500s: P2003 (foreign-key) → 400 — a syntactically-valid but nonexistent `parentId`/`managerUserId`
   * fails its FK; P2002 (unique) → 409 for completeness. Anything else rethrows. Always throws.
   */
  private mapWriteError(err: unknown): never {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as { code: string }).code
      if (code === 'P2002') throw new ConflictException('Unit already exists')
      if (code === 'P2003') throw new BadRequestException('Invalid parentId or managerUserId: referenced row does not exist')
    }
    throw err
  }

  private writeAudit(
    client: TenantClient,
    actor: SettingsActor,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.log({ tenantClient: client, actorUserId: actor.userId, action, entityType, entityId, payload, ipAddress: actor.ipAddress })
  }

  /** Strip `undefined` keys so a partial DTO never overwrites a column with `undefined`. */
  private compact(dto: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined))
  }

  /** The default company settings before any singleton row exists (mirrors the schema defaults). */
  private defaultCompany(): DefaultCompanySettings {
    return { companyName: '', timezone: 'Europe/Warsaw', region: 'EU-Central', locale: 'pl-PL' }
  }

  /**
   * Read the singleton company settings. Open to MANAGER/HR/ADMIN_KLIENTA (gated at the controller).
   * Returns the persisted row, or a synthetic default when none exists yet (never 404).
   */
  async getCompany(client: TenantClient, _actor: SettingsActor): Promise<unknown> {
    const row = await client.companySettings.findFirst()
    return row ?? this.defaultCompany()
  }

  /**
   * Create-or-update the singleton company settings (ADMIN_KLIENTA only). Find-then-update-or-create:
   * the partial-unique index `company_settings_singleton` prevents a second row, so two concurrent
   * first-writes can race — the loser's `create` throws P2002; we re-read the now-existing row and
   * update it instead of surfacing a raw 500 (mirrors the P2002 idiom in ai-config.service.ts). The
   * row carries no PII → before/after snapshots are audited verbatim.
   */
  async upsertCompany(client: TenantClient, actor: SettingsActor, dto: UpdateCompanyDto): Promise<unknown> {
    this.assertAdmin(actor)
    const data = this.compact(dto as Record<string, unknown>)
    const before = await client.companySettings.findFirst()

    let after: { id: string }
    if (before) {
      after = await client.companySettings.update({ where: { id: before.id }, data })
    } else {
      try {
        // companyName has no schema default (NOT NULL) — seed '' unless the DTO supplies one.
        after = await client.companySettings.create({ data: { companyName: '', ...data } })
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
          const existing = await client.companySettings.findFirst()
          if (!existing) throw new ConflictException('Company settings already exist')
          after = await client.companySettings.update({ where: { id: existing.id }, data })
        } else {
          throw err
        }
      }
    }

    await this.writeAudit(client, actor, 'settings.updated', 'CompanySettings', after.id, { before, after })
    return after
  }

  /**
   * List every org unit as a {id,name,parentId,managerUserId,children:[ids]} projection. Open to
   * MANAGER/HR/ADMIN_KLIENTA (gated at the controller). `children` is derived in-memory from the flat
   * set (each unit's direct child ids), so no recursive query is needed.
   */
  async listUnits(client: TenantClient, _actor: SettingsActor): Promise<UnitProjection[]> {
    const units = await client.organizationalUnit.findMany({
      select: { id: true, name: true, parentId: true, managerUserId: true },
      orderBy: { name: 'asc' },
    })
    return units.map((u) => ({
      id: u.id,
      name: u.name,
      parentId: u.parentId,
      managerUserId: u.managerUserId,
      children: units.filter((c) => c.parentId === u.id).map((c) => c.id),
    }))
  }

  /**
   * Create an org unit (ADMIN_KLIENTA only). A bad `parentId` trips the `parent` FK → 400 via
   * `mapWriteError`. Audited as `unit.created`.
   */
  async createUnit(client: TenantClient, actor: SettingsActor, dto: CreateUnitDto): Promise<unknown> {
    this.assertAdmin(actor)

    let created: { id: string }
    try {
      created = await client.organizationalUnit.create({ data: { name: dto.name, parentId: dto.parentId ?? null } })
    } catch (err: unknown) {
      this.mapWriteError(err)
    }

    await this.writeAudit(client, actor, 'unit.created', 'OrganizationalUnit', created.id, { after: created })
    return created
  }

  /**
   * Rename / reparent / assign-manager an org unit (ADMIN_KLIENTA only). The whole edit runs inside a
   * single `$transaction`: when `parentId` is (re)assigned, a cycle guard walks the parent chain up
   * from the proposed parent — a self-parent, or a parent that is a descendant of the moved node,
   * would form a cycle and is rejected with a 400 before any write. A bad `parentId`/`managerUserId`
   * FK surfaces as a 400 (P2003). Audited as `unit.updated` with before/after (no PII).
   */
  async updateUnit(client: TenantClient, actor: SettingsActor, id: string, dto: UpdateUnitDto): Promise<unknown> {
    this.assertAdmin(actor)

    const before = await client.organizationalUnit.findUnique({ where: { id } })
    if (!before) throw new NotFoundException(`Unit ${id} not found`)

    const data = this.compact(dto as Record<string, unknown>)

    const updated = await client.$transaction(async (tx) => {
      if (dto.parentId !== undefined && dto.parentId !== null) {
        if (dto.parentId === id) throw new BadRequestException('A unit cannot be its own parent')
        // Walk up from the proposed parent; if the chain reaches the moved node, this reparent would
        // make `id` an ancestor of itself → cycle. A missing link means a nonexistent parent → 400.
        let cursor: string | null = dto.parentId
        while (cursor) {
          if (cursor === id) throw new BadRequestException('Reparent would create a cycle')
          const node: { parentId: string | null } | null = await tx.organizationalUnit.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          })
          if (!node) throw new BadRequestException('Invalid parentId: unit does not exist')
          cursor = node.parentId
        }
      }

      try {
        return await tx.organizationalUnit.update({ where: { id }, data })
      } catch (err: unknown) {
        this.mapWriteError(err)
      }
    })

    await this.writeAudit(client, actor, 'unit.updated', 'OrganizationalUnit', id, { before, after: updated })
    return updated
  }
}
