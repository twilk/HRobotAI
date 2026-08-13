import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { DokumentyController } from './dokumenty.controller.js'
import { DokumentyService } from './dokumenty.service.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from '../tenant-runtime/audit/audit.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

const dokumenty = {
  list: jest.fn(),
  mine: jest.fn(),
  generuj: jest.fn(),
  getById: jest.fn(),
  zatwierdz: jest.fn(),
  pobierz: jest.fn(),
}

/** Mock client exposing only what SCOPE resolution (`managedUnitIds`) touches. */
function makeClient() {
  return { userRole: { findMany: jest.fn().mockResolvedValue([]) } }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const IP = '1.2.3.4'
const user = (roles: string[], sub = 'kc-1'): JwtPayload => ({ sub, iss: 'x', hrobot_roles: roles, exp: 0 })

const bypass = { canActivate: (_ctx: ExecutionContext) => true }
const bypassI = { intercept: (_ctx: ExecutionContext, next: { handle(): unknown }) => next.handle() }

describe('DokumentyController', () => {
  let controller: DokumentyController
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DokumentyController],
      providers: [{ provide: DokumentyService, useValue: dokumenty }],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(bypass)
      .overrideGuard(RbacGuard).useValue(bypass)
      .overrideInterceptor(TenantContextInterceptor).useValue(bypassI)
      .overrideInterceptor(AuditInterceptor).useValue(bypassI)
      .compile()
    controller = module.get(DokumentyController)
    client = makeClient()
    jest.clearAllMocks()
  })

  const rolesFor = (m: keyof DokumentyController): string[] => new Reflector().get<string[]>(ROLES_KEY, DokumentyController.prototype[m] as (...a: unknown[]) => unknown) ?? []

  // --- pobierz binary integrity (regression: JSON-serialized Buffer produced un-openable PDFs) ----
  describe('GET :id/pobierz — binary integrity', () => {
    it('sends the RAW Buffer via res.send and does NOT return it (Nest would JSON-serialize a returned Buffer to {"type":"Buffer",...}, corrupting the PDF)', async () => {
      const pdf = Buffer.from('%PDF-1.3\n%\xE2\xE3\xCF\xD3 binary', 'binary')
      dokumenty.pobierz.mockResolvedValue({ mime: 'application/pdf', filename: 'nadgodziny.pdf', buffer: pdf })
      const res = { setHeader: jest.fn(), send: jest.fn() }
      const ret = await controller.pobierz(asClient(client), user(['HR']), IP, 'tenant-1', 'doc-1', res as never)
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf')
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="nadgodziny.pdf"')
      expect(res.send).toHaveBeenCalledTimes(1)
      const sent = (res.send as jest.Mock).mock.calls[0][0]
      expect(Buffer.isBuffer(sent)).toBe(true)
      expect(sent).toBe(pdf)
      expect(ret).toBeUndefined()
    })
    it('sends text content (XML KEDU) as a string for a text document', async () => {
      dokumenty.pobierz.mockResolvedValue({ mime: 'application/xml', filename: 'kedu.xml', text: '<?xml version="1.0"?><demo>true</demo>' })
      const res = { setHeader: jest.fn(), send: jest.fn() }
      await controller.pobierz(asClient(client), user(['HR']), IP, 'tenant-1', 'doc-2', res as never)
      expect(res.send).toHaveBeenCalledWith('<?xml version="1.0"?><demo>true</demo>')
    })
  })

  // --- Route ordering: literal `mine` must beat the `:id` param route ---------------------------
  describe('GET route ordering', () => {
    const proto = DokumentyController.prototype
    const pathFor = (m: keyof DokumentyController): string => Reflect.getMetadata(PATH_METADATA, proto[m] as (...a: unknown[]) => unknown) as string

    it('binds mine to `mine` and getOne to `:id`', () => {
      expect(pathFor('mine')).toBe('mine')
      expect(pathFor('getOne')).toBe(':id')
    })

    it('declares `mine` BEFORE `:id` (Nest matches by declaration order)', () => {
      const names = Object.getOwnPropertyNames(proto)
      expect(names.indexOf('mine')).toBeGreaterThanOrEqual(0)
      expect(names.indexOf('mine')).toBeLessThan(names.indexOf('getOne'))
    })
  })

  // --- DOK-6: zatwierdz is MANAGER/HR/ADMIN only — PRACOWNIK cannot approve ----------------------
  describe('DOK-6 — zatwierdz RBAC', () => {
    it('gates zatwierdz to HR/ADMIN/MANAGER and EXCLUDES PRACOWNIK', () => {
      const roles = rolesFor('zatwierdz')
      expect(roles).toEqual([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])
      expect(roles).not.toContain(Role.PRACOWNIK)
    })

    it('gates list + generuj to HR/ADMIN/MANAGER (no PRACOWNIK)', () => {
      expect(rolesFor('list')).toEqual([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])
      expect(rolesFor('generuj')).toEqual([Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER])
    })

    it('opens mine + getOne + pobierz to PRACOWNIK (self, resolved in the service)', () => {
      for (const m of ['mine', 'getOne', 'pobierz'] as const) expect(rolesFor(m)).toContain(Role.PRACOWNIK)
    })
  })

  // --- Scope resolution passed into the service (M16) -------------------------------------------
  describe('scope delegation', () => {
    it('passes null (GLOBAL) scope for an HR actor and never looks up managed units', async () => {
      dokumenty.list.mockResolvedValue([])
      await controller.list(asClient(client), user([Role.HR]), IP)
      expect(dokumenty.list).toHaveBeenCalledWith(asClient(client), expect.objectContaining({ userId: 'kc-1' }), null)
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })

    it('passes a MANAGER their managedUnitIds into generuj', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'u1' }, { unitId: 'u2' }])
      dokumenty.generuj.mockResolvedValue({ id: 'd1' })
      const dto = { type: 'EWIDENCJA_CZASU_PRACY', format: 'PDF', scopeType: 'UNIT', periodStart: '2026-06-01', periodEnd: '2026-06-07', unitId: 'u1' }
      await controller.generuj(asClient(client), user([Role.MANAGER]), IP, 'tenant-1', dto as never)
      expect(dokumenty.generuj).toHaveBeenCalledWith(asClient(client), expect.any(Object), dto, ['u1', 'u2'], 'tenant-1')
    })

    it('delegates zatwierdz with the resolved scope', async () => {
      dokumenty.zatwierdz.mockResolvedValue({ id: 'd1' })
      await controller.zatwierdz(asClient(client), user([Role.HR]), IP, 'd1')
      expect(dokumenty.zatwierdz).toHaveBeenCalledWith(asClient(client), expect.any(Object), 'd1', null)
    })
  })
})
