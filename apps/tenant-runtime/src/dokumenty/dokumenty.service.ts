import { randomUUID, createHash } from 'crypto'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { decryptEmployeePesel } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { DEMO_CONFIG, type DokumentyConfig } from './dokumenty.config.js'
import { DocScopeType, DocumentFormat, DocumentStatus, DocumentType } from './dokumenty.enums.js'
import { aggregateEwidencja, pairEvents, type EwidencjaRow, type LeaveLite, type Period, type RcpEventLite, type ShiftLite, type WorkSession } from './rcp.util.js'
import { overtimeSummary, type OvertimeSummary } from './overtime.util.js'
import { buildKeduModel, type KeduEmployeeInput } from './kedu.util.js'
import { renderKeduXml } from './render/kedu-xml.renderer.js'
import { buildEwidencjaPdfContent, buildKeduPdfContent, buildNadgodzinyPdfContent, renderReportPdf, type PdfContent } from './render/pdf.renderer.js'

/** The version of the calculation engine that produced a document (frozen into `computedFacts`). */
export const ALGORITHM_VERSION = 1

/** The acting user projected from the JWT + IP (mirrors EmployeeActor). */
export interface DokumentyActor {
  userId: string
  roles: string[]
  ipAddress: string
}

/** The generation request as the service consumes it (dates as `YYYY-MM-DD` strings from the DTO). */
export interface GenerujInput {
  type: DocumentType
  format: DocumentFormat
  scopeType: DocScopeType
  periodStart: string
  periodEnd: string
  employeeId?: string
  unitId?: string
}

/**
 * RODO ALLOWLIST for a resolved employee used by the ewidencja/nadgodziny engine. PESEL is NEVER
 * selected here — those two document types are computed with zero decrypt (DOK-7). PESEL is loaded
 * SEPARATELY and only for ZUS, in {@link DokumentyService.decryptPeselsForZus} (DOK-8).
 */
const EMP_SAFE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  position: true,
  unitId: true,
  etat: true,
} as const

type SafeEmployee = { id: string; firstName: string; lastName: string; position: string; unitId: string; etat: unknown }

/**
 * Module-local metadata projection for `GeneratedDocument` (SPEC §6 — "SAFE_SELECT" for lists).
 * Deliberately EXCLUDES `contentText`/`contentBytes`/`contentPath`: document content (which for
 * ZUS carries PESEL) never leaves via the list/metadata surface — only via `pobierz` for an
 * authorized caller, audited. `computedFacts` is included: it is ids+numbers only, never PII (§6).
 */
const DOC_SAFE_SELECT = {
  id: true,
  type: true,
  format: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  scopeType: true,
  employeeId: true,
  unitId: true,
  contentHash: true,
  computedFacts: true,
  algorithmVersion: true,
  replacesDocumentId: true,
  generatedByUserId: true,
  generatedAt: true,
  approvedByUserId: true,
  approvedAt: true,
  retentionUntil: true,
  createdAt: true,
} as const

/** Types that pass through the human approval gate (SPEC §5, DOK-6). Ewidencja is final on generate. */
const APPROVABLE_TYPES: readonly DocumentType[] = [DocumentType.NADGODZINY, DocumentType.ZUS_KEDU]

/**
 * `Moduł Dokumenty` service (SPEC §5/§6, acceptance DOK-6…DOK-13). Thin controller delegates every
 * read/write here; the controller resolves the caller's coarse scope (`null` GLOBAL vs managed unit
 * ids) and passes it in, exactly like `strategic-brain`. Two invariants live here by design:
 *
 *  - PESEL discipline (§6): ewidencja + nadgodziny are computed on {@link EMP_SAFE_SELECT} with NO
 *    decrypt (DOK-7). PESEL is decrypted in exactly ONE place ({@link decryptPeselsForZus}), only
 *    for ZUS_KEDU generate/pobierz, and each decrypt emits an ids-only `dokumenty.zus.pesel-decrypt`
 *    audit entry (DOK-8). PESEL never reaches `computedFacts` or any audit payload.
 *  - Append-only (§2.3, DOK-13): regenerating supersedes the prior head (old → SUPERSEDED, new row
 *    carries `replacesDocumentId`). Content is frozen by a `sha256` `contentHash`.
 *
 * The module NEVER sends anything externally (art. 22 RODO): `zatwierdz` only stamps `approvedBy*`;
 * there is no lifecycle state off the module (DOK-10).
 */
@Injectable()
export class DokumentyService {
  private readonly logger = new Logger(DokumentyService.name)
  private readonly cfg: DokumentyConfig = DEMO_CONFIG

  constructor(
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  // ===============================================================================================
  // Generate (POST /dokumenty/generuj)
  // ===============================================================================================

  /**
   * Generate a document for a period + scope. Loads RCP events / shifts / leaves (ewidencja) via the
   * allowlist, runs the D2 engine, renders (D3), and stores an append-only `GeneratedDocument`
   * (status GENERATED). Regeneration supersedes the prior head (DOK-13). `scope` is `null` for a
   * GLOBAL actor (HR/ADMIN) or their managed unit ids (MANAGER); `scopeType=ALL` is GLOBAL-only.
   */
  async generuj(client: TenantClient, actor: DokumentyActor, input: GenerujInput, scope: string[] | null, tenantId: string): Promise<Record<string, unknown>> {
    const period = this.toPeriod(input.periodStart, input.periodEnd)
    const employees = await this.resolveEmployees(client, input, scope)
    if (employees.length === 0) throw new NotFoundException('No employees resolved for the requested scope')

    const empIds = employees.map((e) => e.id)
    const { ewidencja, overtime, sessions } = await this.compute(client, empIds, period)

    // Reserve the document id up front so the ZUS pesel-decrypt audit can reference it BEFORE the
    // row is written (single create, no post-hoc content mutation of an append-only row).
    const documentId = randomUUID()

    const { contentText, contentBytes } = await this.render(client, actor, input, employees, ewidencja, overtime, sessions, documentId, tenantId)
    const contentHash = this.hash(contentText ?? contentBytes ?? '')
    const computedFacts = this.buildComputedFacts(input, employees, ewidencja, overtime, period)

    // Append-only: supersede the current head for this (type, format, scope, period) key.
    const prior = await client.generatedDocument.findFirst({
      where: {
        type: input.type,
        format: input.format,
        scopeType: input.scopeType,
        employeeId: input.employeeId ?? null,
        unitId: input.unitId ?? null,
        periodStart: period.start,
        periodEnd: period.end,
        status: { in: [DocumentStatus.GENERATED, DocumentStatus.APPROVED] },
      },
      orderBy: { generatedAt: 'desc' },
      select: { id: true },
    })
    if (prior) {
      await client.generatedDocument.update({ where: { id: prior.id }, data: { status: DocumentStatus.SUPERSEDED } })
    }

    const created = await client.generatedDocument.create({
      data: {
        id: documentId,
        type: input.type,
        format: input.format,
        status: DocumentStatus.GENERATED,
        periodStart: period.start,
        periodEnd: period.end,
        scopeType: input.scopeType,
        employeeId: input.employeeId ?? null,
        unitId: input.unitId ?? null,
        contentText: contentText ?? null,
        contentBytes: contentBytes ?? null,
        contentHash,
        computedFacts: computedFacts as never,
        algorithmVersion: ALGORITHM_VERSION,
        replacesDocumentId: prior?.id ?? null,
        generatedByUserId: actor.userId,
        retentionUntil: this.retentionUntil(period.end),
      },
      select: DOC_SAFE_SELECT,
    })

    // Ids-only audit (DOK-11): documentId + employeeIds (and the replaced id) — no names/numbers-with-PII.
    await this.audit.log({
      tenantClient: client,
      actorUserId: actor.userId,
      action: 'dokumenty.generuj',
      entityType: 'GeneratedDocument',
      entityId: documentId,
      payload: { documentId, employeeIds: empIds, ...(prior ? { replacesDocumentId: prior.id } : {}) },
      ipAddress: actor.ipAddress,
    })

    return created as Record<string, unknown>
  }

  // ===============================================================================================
  // Approve (POST /dokumenty/:id/zatwierdz)
  // ===============================================================================================

  /**
   * Human approval gate (SPEC §5, DOK-6, art. 22 RODO). NADGODZINY/ZUS_KEDU move GENERATED →
   * APPROVED and get `approvedBy*` stamped. It performs NO external action — no send, no export.
   * MANAGER scope enforced here (a doc outside their units is 403); PRACOWNIK is barred at the
   * controller's role gate.
   */
  async zatwierdz(client: TenantClient, actor: DokumentyActor, id: string, scope: string[] | null): Promise<Record<string, unknown>> {
    const doc = await this.loadForAccess(client, id)
    this.assertManagerScope(doc, scope)

    if (!APPROVABLE_TYPES.includes(doc.type as DocumentType)) {
      throw new BadRequestException(`Document type ${doc.type} is not subject to approval`)
    }
    if (doc.status !== DocumentStatus.GENERATED) {
      throw new ConflictException(`Document ${id} is not in GENERATED state (is ${doc.status})`)
    }

    const updated = await client.generatedDocument.update({
      where: { id },
      data: { status: DocumentStatus.APPROVED, approvedByUserId: actor.userId, approvedAt: new Date() },
      select: DOC_SAFE_SELECT,
    })

    await this.audit.log({
      tenantClient: client,
      actorUserId: actor.userId,
      action: 'dokumenty.zatwierdz',
      entityType: 'GeneratedDocument',
      entityId: id,
      payload: { documentId: id },
      ipAddress: actor.ipAddress,
    })

    return updated as Record<string, unknown>
  }

  // ===============================================================================================
  // Download (GET /dokumenty/:id/pobierz)
  // ===============================================================================================

  /**
   * Materialized content of a document + mime + filename (SPEC §5). For EWIDENCJA/NADGODZINY the
   * stored content is returned as-is (NO decrypt — DOK-7). For ZUS_KEDU the content is
   * re-materialized through the SINGLE controlled decrypt path ({@link decryptPeselsForZus}, DOK-8)
   * so PESEL is produced under audit at download time rather than lingering unaudited. Access
   * (global / manager-scope / self) is checked before any content is touched.
   */
  async pobierz(
    client: TenantClient,
    actor: DokumentyActor,
    id: string,
    scope: string[] | null,
    tenantId: string,
  ): Promise<{ filename: string; mime: string; buffer?: Buffer; text?: string }> {
    const doc = await this.loadForAccess(client, id)
    await this.assertReadAccess(client, doc, scope, actor)

    let buffer: Buffer | undefined
    let text: string | undefined

    if (doc.type === DocumentType.ZUS_KEDU) {
      // Re-materialize ZUS content through the audited decrypt path (DOK-8) — never trust an
      // unaudited read of PESEL-bearing bytes.
      const input: GenerujInput = {
        type: doc.type as DocumentType,
        format: doc.format as DocumentFormat,
        scopeType: doc.scopeType as DocScopeType,
        periodStart: (doc.periodStart as Date).toISOString(),
        periodEnd: (doc.periodEnd as Date).toISOString(),
        employeeId: (doc.employeeId as string | null) ?? undefined,
        unitId: (doc.unitId as string | null) ?? undefined,
      }
      const period = { start: doc.periodStart as Date, end: doc.periodEnd as Date }
      const employees = await this.resolveEmployees(client, input, scope, /* skipScopeAssert */ true)
      const { ewidencja, overtime } = await this.compute(client, employees.map((e) => e.id), period)
      const rendered = await this.render(client, actor, input, employees, ewidencja, overtime, [], id, tenantId)
      buffer = rendered.contentBytes ?? undefined
      text = rendered.contentText ?? undefined
    } else {
      const raw = await client.generatedDocument.findUnique({ where: { id }, select: { contentText: true, contentBytes: true } })
      const bytes = raw?.contentBytes as Buffer | null | undefined
      buffer = bytes ?? undefined
      text = (raw?.contentText as string | null | undefined) ?? undefined
    }

    await this.audit.log({
      tenantClient: client,
      actorUserId: actor.userId,
      action: 'dokumenty.pobierz',
      entityType: 'GeneratedDocument',
      entityId: id,
      payload: { documentId: id },
      ipAddress: actor.ipAddress,
    })

    const isXml = doc.format === DocumentFormat.XML_KEDU
    return {
      filename: `${String(doc.type).toLowerCase()}-${id}.${isXml ? 'xml' : 'pdf'}`,
      mime: isXml ? 'application/xml' : 'application/pdf',
      buffer,
      text,
    }
  }

  // ===============================================================================================
  // Read metadata (GET /dokumenty, /dokumenty/mine, /dokumenty/:id)
  // ===============================================================================================

  /** Metadata list (no content, no PESEL). GLOBAL sees all; MANAGER sees only docs in their units. */
  async list(client: TenantClient, _actor: DokumentyActor, scope: string[] | null): Promise<unknown[]> {
    if (scope === null) {
      return client.generatedDocument.findMany({ orderBy: { generatedAt: 'desc' }, select: DOC_SAFE_SELECT })
    }
    return client.generatedDocument.findMany({
      where: { OR: [{ unitId: { in: scope } }, { employee: { unitId: { in: scope } } }] },
      orderBy: { generatedAt: 'desc' },
      select: DOC_SAFE_SELECT,
    })
  }

  /**
   * The caller's OWN ewidencja (SPEC §5, DECYZJA-4M #6 — self, read-only, EWIDENCJA only). Resolves
   * the caller's Employee via their Keycloak subject; returns metadata only (never content/PESEL).
   */
  async mine(client: TenantClient, actor: DokumentyActor): Promise<unknown[]> {
    const ownId = await this.ownEmployeeId(client, actor.userId)
    if (!ownId) return []
    return client.generatedDocument.findMany({
      where: { employeeId: ownId, type: DocumentType.EWIDENCJA_CZASU_PRACY },
      orderBy: { generatedAt: 'desc' },
      select: DOC_SAFE_SELECT,
    })
  }

  /** Single-document metadata (no content). 404 first, then access (global / manager-scope / self). */
  async getById(client: TenantClient, actor: DokumentyActor, id: string, scope: string[] | null): Promise<Record<string, unknown>> {
    const doc = await this.loadForAccess(client, id)
    await this.assertReadAccess(client, doc, scope, actor)
    const safe: Record<string, unknown> = {}
    for (const key of Object.keys(DOC_SAFE_SELECT)) safe[key] = (doc as Record<string, unknown>)[key]
    return safe
  }

  // ===============================================================================================
  // Internals
  // ===============================================================================================

  private toPeriod(start: string, end: string): Period {
    return { start: this.toUtcDate(start), end: this.toUtcDate(end) }
  }

  /** Normalize a `YYYY-MM-DD`(or ISO) string to a UTC-midnight Date, matching @db.Date semantics. */
  private toUtcDate(s: string): Date {
    const d = new Date(s)
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }

  private hash(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex')
  }

  private retentionUntil(periodEnd: Date): Date {
    const d = new Date(periodEnd)
    d.setUTCMonth(d.getUTCMonth() + this.cfg.retencjaMiesiace)
    return d
  }

  private async ownEmployeeId(client: TenantClient, userId: string): Promise<string | null> {
    const me = await client.employee.findFirst({ where: { user: { keycloakSub: userId } }, select: { id: true } })
    return me?.id ?? null
  }

  /**
   * Resolve the employees in scope for a request (allowlist projection — NO pesel). Enforces the
   * MANAGER unit-scope and the `scopeType=ALL` GLOBAL-only rule (unless `skipScopeAssert`, used when
   * re-materializing an already-authorized document on download).
   */
  private async resolveEmployees(client: TenantClient, input: GenerujInput, scope: string[] | null, skipScopeAssert = false): Promise<SafeEmployee[]> {
    if (input.scopeType === DocScopeType.ALL) {
      if (!skipScopeAssert && scope !== null) throw new ForbiddenException('scopeType=ALL is restricted to HR/ADMIN')
      return client.employee.findMany({ select: EMP_SAFE_SELECT }) as unknown as Promise<SafeEmployee[]>
    }
    if (input.scopeType === DocScopeType.UNIT) {
      const unitId = input.unitId as string
      if (!skipScopeAssert && scope !== null && !scope.includes(unitId)) throw new ForbiddenException('Unit is outside your scope')
      return client.employee.findMany({ where: { unitId }, select: EMP_SAFE_SELECT }) as unknown as Promise<SafeEmployee[]>
    }
    // EMPLOYEE
    const emp = (await client.employee.findUnique({ where: { id: input.employeeId as string }, select: EMP_SAFE_SELECT })) as SafeEmployee | null
    if (!emp) throw new NotFoundException(`Employee ${input.employeeId} not found`)
    if (!skipScopeAssert && scope !== null && !scope.includes(emp.unitId)) throw new ForbiddenException('Employee is outside your scope')
    return [emp]
  }

  /** Load the RCP/shift/leave inputs for the period and run the D2 engine per employee. */
  private async compute(
    client: TenantClient,
    empIds: string[],
    period: Period,
  ): Promise<{ ewidencja: Record<string, EwidencjaRow[]>; overtime: Record<string, OvertimeSummary>; sessions: Record<string, WorkSession[]> }> {
    // occurredAt is a timestamp; include the whole end day.
    const endExclusive = new Date(period.end)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

    const [events, shifts, leaves] = await Promise.all([
      client.rcpEvent.findMany({
        where: { employeeId: { in: empIds }, occurredAt: { gte: period.start, lt: endExclusive } },
        select: { employeeId: true, occurredAt: true, type: true },
      }),
      client.shift.findMany({
        where: { employeeId: { in: empIds }, date: { gte: period.start, lte: period.end } },
        select: { employeeId: true, date: true },
      }),
      client.leaveRequest.findMany({
        where: { employeeId: { in: empIds }, startDate: { lte: period.end }, endDate: { gte: period.start } },
        select: { employeeId: true, startDate: true, endDate: true, type: true, status: true },
      }),
    ])

    const ewidencja: Record<string, EwidencjaRow[]> = {}
    const overtime: Record<string, OvertimeSummary> = {}
    const sessions: Record<string, WorkSession[]> = {}

    for (const empId of empIds) {
      const empEvents = (events as RcpEventLite[]).filter((e) => e.employeeId === empId)
      const empShifts = (shifts as ShiftLite[]).filter((s) => s.employeeId === empId)
      const empLeaves = (leaves as LeaveLite[]).filter((l) => l.employeeId === empId)
      const rows = aggregateEwidencja(empEvents, empLeaves, empShifts, period, this.cfg)
      const sess = pairEvents(empEvents)
      ewidencja[empId] = rows
      sessions[empId] = sess
      overtime[empId] = overtimeSummary(period, rows, sess, this.cfg)
    }
    return { ewidencja, overtime, sessions }
  }

  /**
   * `computedFacts` (§2.3/§6): ids + numbers ONLY. Never PESEL, name, address or free-text rationale
   * — DOK-11 asserts this. Reproduces "why this many overtime hours" without any PII.
   */
  private buildComputedFacts(
    input: GenerujInput,
    employees: SafeEmployee[],
    ewidencja: Record<string, EwidencjaRow[]>,
    overtime: Record<string, OvertimeSummary>,
    period: Period,
  ): Record<string, unknown> {
    return {
      type: input.type,
      scopeType: input.scopeType,
      periodStart: period.start.toISOString().slice(0, 10),
      periodEnd: period.end.toISOString().slice(0, 10),
      algorithmVersion: ALGORITHM_VERSION,
      employees: employees.map((e) => {
        const ot = overtime[e.id]
        const rows = ewidencja[e.id] ?? []
        return {
          employeeId: e.id,
          workedMinutes: rows.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0),
          ot50Min: ot?.ot50Min ?? 0,
          ot100Min: ot?.ot100Min ?? 0,
          ot100NightSundayHolidayMin: ot?.ot100NightSundayHolidayMin ?? 0,
          daysWithoutRcp: ot?.daysWithoutRcp ?? 0,
        }
      }),
    }
  }

  /**
   * Render the document content per type/format, reusing the D3 renderers. For ZUS_KEDU this is the
   * ONLY caller of {@link decryptPeselsForZus} — the single, audited PESEL-decrypt point (DOK-8).
   */
  private async render(
    client: TenantClient,
    actor: DokumentyActor,
    input: GenerujInput,
    employees: SafeEmployee[],
    ewidencja: Record<string, EwidencjaRow[]>,
    overtime: Record<string, OvertimeSummary>,
    _sessions: WorkSession[] | Record<string, WorkSession[]>,
    documentId: string,
    tenantId: string,
  ): Promise<{ contentText: string | null; contentBytes: Buffer | null }> {
    const period = this.toPeriod(input.periodStart, input.periodEnd)

    if (input.type === DocumentType.EWIDENCJA_CZASU_PRACY) {
      const contents: PdfContent[] = employees.map((e) =>
        buildEwidencjaPdfContent({ employeeId: e.id, imie: e.firstName, nazwisko: e.lastName }, period, ewidencja[e.id] ?? []),
      )
      return { contentText: null, contentBytes: await renderReportPdf(contents) }
    }

    if (input.type === DocumentType.NADGODZINY) {
      const contents: PdfContent[] = employees.map((e) =>
        buildNadgodzinyPdfContent({ employeeId: e.id, imie: e.firstName, nazwisko: e.lastName }, period, overtime[e.id] ?? this.emptyOvertime()),
      )
      return { contentText: null, contentBytes: await renderReportPdf(contents) }
    }

    // ZUS_KEDU — the ONLY decrypt path (DOK-8).
    const keduEmployees = await this.decryptPeselsForZus(client, actor, employees, documentId, tenantId)
    const model = buildKeduModel(keduEmployees, period, ewidencja, overtime, this.cfg)
    if (input.format === DocumentFormat.XML_KEDU) {
      return { contentText: renderKeduXml(model), contentBytes: null }
    }
    return { contentText: null, contentBytes: await renderReportPdf([buildKeduPdfContent(model)]) }
  }

  /**
   * The SINGLE controlled PESEL-decrypt (SPEC §6, DOK-8). Loads pesel ciphertext for the ZUS
   * employees, decrypts each via `decryptEmployeePesel` (the exact `employees.service.ts` pattern),
   * and emits an IDS-ONLY `dokumenty.zus.pesel-decrypt` audit — the decrypted PESEL is handed to the
   * KEDU model builder and never enters `computedFacts`, logs, or any audit payload.
   */
  private async decryptPeselsForZus(
    client: TenantClient,
    actor: DokumentyActor,
    employees: SafeEmployee[],
    documentId: string,
    tenantId: string,
  ): Promise<KeduEmployeeInput[]> {
    const empIds = employees.map((e) => e.id)
    const rows = (await client.employee.findMany({
      where: { id: { in: empIds } },
      select: { id: true, firstName: true, lastName: true, pesel: true },
    })) as Array<{ id: string; firstName: string; lastName: string; pesel: string }>

    const kedu: KeduEmployeeInput[] = rows.map((r) => ({
      employeeId: r.id,
      pesel: decryptEmployeePesel(this.encryption, tenantId, r.pesel),
      imie: r.firstName,
      nazwisko: r.lastName,
    }))

    await this.audit.log({
      tenantClient: client,
      actorUserId: actor.userId,
      action: 'dokumenty.zus.pesel-decrypt',
      entityType: 'GeneratedDocument',
      entityId: documentId,
      payload: { documentId, employeeIds: empIds },
      ipAddress: actor.ipAddress,
    })

    return kedu
  }

  private emptyOvertime(): OvertimeSummary {
    return { ot50Min: 0, ot100Min: 0, nightMin: 0, sundayMin: 0, holidayMin: 0, ot100NightSundayHolidayMin: 0, count: 0, daysWithoutRcp: 0 }
  }

  /** Load a document (full row) for access checks; 404 if missing. Includes `employee.unitId`. */
  private async loadForAccess(client: TenantClient, id: string): Promise<Record<string, unknown>> {
    const doc = await client.generatedDocument.findUnique({
      where: { id },
      select: { ...DOC_SAFE_SELECT, employee: { select: { unitId: true } } },
    })
    if (!doc) throw new NotFoundException(`Document ${id} not found`)
    return doc as Record<string, unknown>
  }

  /** The unit a document belongs to (for scope): its `unitId`, else its employee's `unitId`. */
  private docUnitId(doc: Record<string, unknown>): string | null {
    const unitId = doc.unitId as string | null
    if (unitId) return unitId
    const emp = doc.employee as { unitId?: string } | null
    return emp?.unitId ?? null
  }

  /** MANAGER-scope check for a write (zatwierdz): GLOBAL passes; else the doc's unit must be in scope. */
  private assertManagerScope(doc: Record<string, unknown>, scope: string[] | null): void {
    if (scope === null) return
    const unit = this.docUnitId(doc)
    if (!unit || !scope.includes(unit)) throw new ForbiddenException('Document is outside your scope')
  }

  /**
   * READ access (getById/pobierz): GLOBAL passes; a MANAGER passes if the doc's unit is in scope; a
   * plain employee passes only for their OWN document (employeeId ↔ their Employee via keycloakSub).
   */
  private async assertReadAccess(client: TenantClient, doc: Record<string, unknown>, scope: string[] | null, actor: DokumentyActor): Promise<void> {
    if (scope === null) return
    const unit = this.docUnitId(doc)
    if (unit && scope.includes(unit)) return
    const ownId = await this.ownEmployeeId(client, actor.userId)
    if (ownId && doc.employeeId === ownId) return
    throw new ForbiddenException('Document is outside your scope')
  }
}
