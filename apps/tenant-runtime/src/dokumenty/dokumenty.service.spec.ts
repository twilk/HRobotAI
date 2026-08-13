import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { DokumentyService, type DokumentyActor, type GenerujInput } from './dokumenty.service.js'
import { DocScopeType, DocumentFormat, DocumentStatus, DocumentType } from './dokumenty.enums.js'

// This spec exercises DokumentyService orchestration (RBAC, decrypt boundary, audit trail) — NOT
// PDF rendering. `renderReportPdf` (tor DOK rewrite) spawns a real Chromium process via CDP, which
// is correct behavior for production but would make every test in this file depend on a browser
// being installed and add seconds per render — breaking the "hermetic unit lane" this file lives in
// (see apps/tenant-runtime/jest.config.cjs's own comment on that boundary). Only `renderReportPdf`
// is stubbed; the pure `buildXPdfContent` builders stay real (their correctness is covered by
// pdf.renderer.spec.ts, and the real Chrome round-trip by pdf.renderer.chrome.integration.spec.ts).
jest.mock('./render/pdf.renderer.js', () => ({
  ...jest.requireActual('./render/pdf.renderer.js'),
  renderReportPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 (mocked in DokumentyService unit spec)')),
}))

/** The synthetic PESEL our decrypt mock returns — asserted to NEVER leak into facts/audit. */
const FAKE_PESEL = '44051401359'

/** Mock tenant client exposing exactly the delegates DokumentyService touches. */
function makeClient() {
  return {
    employee: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    rcpEvent: { findMany: jest.fn().mockResolvedValue([]) },
    shift: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    generatedDocument: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const ACTOR: DokumentyActor = { userId: 'kc-1', roles: ['HR'], ipAddress: '1.2.3.4' }

const EMP = { id: 'emp-1', firstName: 'Anna', lastName: 'Kowalska', position: 'KASJER', unitId: 'unit-1', etat: 1 }

function input(over: Partial<GenerujInput> = {}): GenerujInput {
  return {
    type: DocumentType.EWIDENCJA_CZASU_PRACY,
    format: DocumentFormat.PDF,
    scopeType: DocScopeType.EMPLOYEE,
    periodStart: '2026-06-01',
    periodEnd: '2026-06-07',
    employeeId: 'emp-1',
    ...over,
  }
}

describe('DokumentyService', () => {
  let service: DokumentyService
  let client: MockClient
  let audit: { log: jest.Mock }
  let encryption: { decrypt: jest.Mock; encrypt: jest.Mock }

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    encryption = { decrypt: jest.fn().mockReturnValue(FAKE_PESEL), encrypt: jest.fn() }
    service = new DokumentyService(audit as unknown as AuditService, encryption as unknown as EncryptionService)
    client = makeClient()
    client.employee.findUnique.mockResolvedValue(EMP)
    client.employee.findMany.mockResolvedValue([{ id: EMP.id, firstName: EMP.firstName, lastName: EMP.lastName, pesel: 'cipher-blob' }])
    client.generatedDocument.findFirst.mockResolvedValue(null)
    client.generatedDocument.create.mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ ...args.data }))
    client.generatedDocument.update.mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'x', ...args.data }))
  })

  const createArg = () => client.generatedDocument.create.mock.calls[0]![0] as { data: Record<string, unknown> }
  const auditActions = () => audit.log.mock.calls.map((c) => (c[0] as { action: string }).action)

  // --- DOK-7: ewidencja/nadgodziny NEVER decrypt PESEL ------------------------------------------
  describe('DOK-7 — no PESEL decrypt for ewidencja/nadgodziny', () => {
    it('EWIDENCJA_CZASU_PRACY never calls decrypt and never emits a pesel-decrypt audit', async () => {
      await service.generuj(asClient(client), ACTOR, input(), null, 'tenant-1')
      expect(encryption.decrypt).not.toHaveBeenCalled()
      expect(auditActions()).not.toContain('dokumenty.zus.pesel-decrypt')
      expect(auditActions()).toContain('dokumenty.generuj')
    })

    it('NADGODZINY never calls decrypt', async () => {
      await service.generuj(asClient(client), ACTOR, input({ type: DocumentType.NADGODZINY }), null, 'tenant-1')
      expect(encryption.decrypt).not.toHaveBeenCalled()
      expect(auditActions()).not.toContain('dokumenty.zus.pesel-decrypt')
    })
  })

  // --- DOK-8: ZUS decrypts once + emits an ids-only pesel-decrypt audit -------------------------
  describe('DOK-8 — ZUS_KEDU decrypts PESEL once, under audit', () => {
    it('decrypts each employee PESEL once and emits dokumenty.zus.pesel-decrypt (ids only)', async () => {
      await service.generuj(asClient(client), ACTOR, input({ type: DocumentType.ZUS_KEDU, format: DocumentFormat.XML_KEDU }), null, 'tenant-1')

      expect(encryption.decrypt).toHaveBeenCalledTimes(1)
      const peselAudit = audit.log.mock.calls.map((c) => c[0] as { action: string; payload: Record<string, unknown> }).find((a) => a.action === 'dokumenty.zus.pesel-decrypt')
      expect(peselAudit).toBeDefined()
      expect(peselAudit!.payload).toEqual({
        documentId: expect.any(String),
        employeeIds: ['emp-1'],
        decryptedEmployeeIds: ['emp-1'],
        failedEmployeeIds: [],
      })
    })

    it('excludes an employee whose PESEL fails to decrypt instead of failing the whole export', async () => {
      // Regression: a company-wide ZUS export 500'd because ONE employee (of many) had unreadable
      // ciphertext (found live: a leftover unencrypted placeholder seed row). The other employees'
      // payroll must still generate.
      client.employee.findMany.mockResolvedValue([
        { id: 'emp-1', firstName: EMP.firstName, lastName: EMP.lastName, position: EMP.position, unitId: EMP.unitId, etat: EMP.etat, pesel: 'cipher-blob' },
        { id: 'emp-2', firstName: 'Zofia', lastName: 'Placeholder', position: EMP.position, unitId: EMP.unitId, etat: EMP.etat, pesel: 'DEMO-PLACEHOLDER-UNENCRYPTED-PESEL' },
      ])
      encryption.decrypt.mockImplementation((cipher: string) => {
        if (cipher === 'DEMO-PLACEHOLDER-UNENCRYPTED-PESEL') throw new Error('decrypt: unknown key version 12 — wrong keyring or corrupt payload')
        return FAKE_PESEL
      })

      await service.generuj(asClient(client), ACTOR, input({ type: DocumentType.ZUS_KEDU, format: DocumentFormat.XML_KEDU, scopeType: DocScopeType.ALL, employeeId: undefined }), null, 'tenant-1')

      const peselAudit = audit.log.mock.calls.map((c) => c[0] as { action: string; payload: Record<string, unknown> }).find((a) => a.action === 'dokumenty.zus.pesel-decrypt')
      expect(peselAudit!.payload).toEqual({
        documentId: expect.any(String),
        employeeIds: ['emp-1', 'emp-2'],
        decryptedEmployeeIds: ['emp-1'],
        failedEmployeeIds: ['emp-2'],
      })
    })

    it('fails loudly (400, not 500) only when EVERY employee in scope is unreadable', async () => {
      client.employee.findMany.mockResolvedValue([{ id: 'emp-2', firstName: 'Zofia', lastName: 'Placeholder', pesel: 'DEMO-PLACEHOLDER-UNENCRYPTED-PESEL' }])
      encryption.decrypt.mockImplementation(() => {
        throw new Error('decrypt: unknown key version 12 — wrong keyring or corrupt payload')
      })

      await expect(service.generuj(asClient(client), ACTOR, input({ type: DocumentType.ZUS_KEDU, format: DocumentFormat.XML_KEDU }), null, 'tenant-1')).rejects.toThrow(BadRequestException)
    })
  })

  // --- DOK-11: audit payloads + computedFacts are ids/numbers only (no PII) ---------------------
  describe('DOK-11 — ids-only audit + PII-free computedFacts', () => {
    const FORBIDDEN_KEYS = ['pesel', 'name', 'firstName', 'lastName', 'imie', 'nazwisko', 'rationale', 'email', 'address', 'homeAddress']

    function assertNoPii(obj: unknown) {
      const json = JSON.stringify(obj)
      expect(json).not.toContain(FAKE_PESEL)
      const scan = (v: unknown) => {
        if (v && typeof v === 'object') {
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            expect(FORBIDDEN_KEYS).not.toContain(k)
            scan(val)
          }
        }
      }
      scan(obj)
    }

    it('ZUS computedFacts contains only ids + numbers (no pesel/name), and no audit payload leaks PII', async () => {
      await service.generuj(asClient(client), ACTOR, input({ type: DocumentType.ZUS_KEDU, format: DocumentFormat.XML_KEDU }), null, 'tenant-1')
      assertNoPii(createArg().data.computedFacts)
      for (const call of audit.log.mock.calls) assertNoPii((call[0] as { payload: unknown }).payload)
    })
  })

  // --- DOK-13: append-only regenerate → new row + replacesDocumentId + old SUPERSEDED -----------
  describe('DOK-13 — append-only regenerate', () => {
    it('first generation creates a head with no predecessor and supersedes nothing', async () => {
      await service.generuj(asClient(client), ACTOR, input(), null, 'tenant-1')
      expect(createArg().data.status).toBe(DocumentStatus.GENERATED)
      expect(createArg().data.replacesDocumentId).toBeNull()
      expect(client.generatedDocument.update).not.toHaveBeenCalled()
      expect(typeof createArg().data.contentHash).toBe('string')
    })

    it('regeneration supersedes the prior head and links the new row via replacesDocumentId', async () => {
      client.generatedDocument.findFirst.mockResolvedValue({ id: 'doc-old' })
      await service.generuj(asClient(client), ACTOR, input(), null, 'tenant-1')

      expect(client.generatedDocument.update).toHaveBeenCalledWith({ where: { id: 'doc-old' }, data: { status: DocumentStatus.SUPERSEDED } })
      expect(createArg().data.replacesDocumentId).toBe('doc-old')
      expect(createArg().data.status).toBe(DocumentStatus.GENERATED)
    })
  })

  // --- Scope enforcement (service-level, M16) ----------------------------------------------------
  describe('scope enforcement', () => {
    it('rejects scopeType=ALL for a non-global (MANAGER) actor', async () => {
      await expect(
        service.generuj(asClient(client), { ...ACTOR, roles: ['MANAGER'] }, input({ scopeType: DocScopeType.ALL, employeeId: undefined }), ['unit-1'], 'tenant-1'),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('allows scopeType=ALL for a global actor (scope null)', async () => {
      client.employee.findMany.mockResolvedValueOnce([EMP])
      await expect(
        service.generuj(asClient(client), ACTOR, input({ scopeType: DocScopeType.ALL, employeeId: undefined }), null, 'tenant-1'),
      ).resolves.toBeDefined()
    })

    it('rejects an EMPLOYEE-scope generate when the employee is outside a MANAGER scope', async () => {
      client.employee.findUnique.mockResolvedValue({ ...EMP, unitId: 'unit-OTHER' })
      await expect(
        service.generuj(asClient(client), { ...ACTOR, roles: ['MANAGER'] }, input(), ['unit-1'], 'tenant-1'),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  // --- zatwierdz (human gate) --------------------------------------------------------------------
  describe('zatwierdz', () => {
    it('moves a NADGODZINY GENERATED doc to APPROVED, stamps approvedBy/At, audits (ids-only), sends nothing', async () => {
      client.generatedDocument.findUnique.mockResolvedValue({ id: 'doc-1', type: DocumentType.NADGODZINY, status: DocumentStatus.GENERATED, unitId: 'unit-1', employee: null })
      await service.zatwierdz(asClient(client), ACTOR, 'doc-1', null)

      const upd = client.generatedDocument.update.mock.calls[0]![0] as { data: Record<string, unknown> }
      expect(upd.data.status).toBe(DocumentStatus.APPROVED)
      expect(upd.data.approvedByUserId).toBe('kc-1')
      expect(upd.data.approvedAt).toBeInstanceOf(Date)
      expect(auditActions()).toEqual(['dokumenty.zatwierdz'])
    })

    it('refuses to approve an EWIDENCJA document (not an approvable type)', async () => {
      client.generatedDocument.findUnique.mockResolvedValue({ id: 'doc-2', type: DocumentType.EWIDENCJA_CZASU_PRACY, status: DocumentStatus.GENERATED, unitId: 'unit-1', employee: null })
      await expect(service.zatwierdz(asClient(client), ACTOR, 'doc-2', null)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('a MANAGER cannot approve a document outside their unit scope', async () => {
      client.generatedDocument.findUnique.mockResolvedValue({ id: 'doc-3', type: DocumentType.NADGODZINY, status: DocumentStatus.GENERATED, unitId: 'unit-OTHER', employee: null })
      await expect(service.zatwierdz(asClient(client), { ...ACTOR, roles: ['MANAGER'] }, 'doc-3', ['unit-1'])).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  // --- mine (self, ewidencja only) ---------------------------------------------------------------
  describe('mine', () => {
    it('returns [] when the caller has no linked employee', async () => {
      client.employee.findFirst.mockResolvedValue(null)
      const out = await service.mine(asClient(client), { ...ACTOR, roles: ['PRACOWNIK'] })
      expect(out).toEqual([])
    })

    it('lists only the caller`s OWN ewidencja documents', async () => {
      client.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
      client.generatedDocument.findMany.mockResolvedValue([{ id: 'd1' }])
      await service.mine(asClient(client), { ...ACTOR, roles: ['PRACOWNIK'] })
      const arg = client.generatedDocument.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
      expect(arg.where).toEqual({ employeeId: 'emp-self', type: DocumentType.EWIDENCJA_CZASU_PRACY })
    })
  })
})
