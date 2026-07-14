import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { SettingsService, type SettingsActor } from './ustawienia.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'

/** A mock tenant client exposing exactly the delegates SettingsService touches. */
function makeClient() {
  const client = {
    companySettings: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    organizationalUnit: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    // The mock $transaction runs the callback against the same client (acts as `tx`).
    $transaction: jest.fn(),
  }
  client.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(client))
  return client
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const ADMIN: SettingsActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.1' }
const HR: SettingsActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.2' }
const MANAGER: SettingsActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.3' }

describe('SettingsService', () => {
  let service: SettingsService
  let audit: { log: jest.Mock }
  let client: MockClient

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    const module: TestingModule = await Test.createTestingModule({
      providers: [SettingsService, { provide: AuditService, useValue: audit }],
    }).compile()
    service = module.get(SettingsService)
    client = makeClient()
    jest.clearAllMocks()
  })

  describe('getCompany', () => {
    it('returns the persisted singleton when one exists', async () => {
      const row = { id: 'cs1', companyName: 'Acme', timezone: 'Europe/Warsaw', region: 'EU-Central', locale: 'pl-PL' }
      client.companySettings.findFirst.mockResolvedValue(row)

      await expect(service.getCompany(asClient(client), HR)).resolves.toBe(row)
    })

    it('returns synthetic defaults when no row exists yet (never 404)', async () => {
      client.companySettings.findFirst.mockResolvedValue(null)

      await expect(service.getCompany(asClient(client), MANAGER)).resolves.toEqual({
        companyName: '',
        timezone: 'Europe/Warsaw',
        region: 'EU-Central',
        locale: 'pl-PL',
      })
    })

    it('never persists a row as a side effect of a read (no create/update, DB stays empty)', async () => {
      client.companySettings.findFirst.mockResolvedValue(null)

      await service.getCompany(asClient(client), MANAGER)

      expect(client.companySettings.create).not.toHaveBeenCalled()
      expect(client.companySettings.update).not.toHaveBeenCalled()
      // Reading again proves nothing was written by the first read.
      await expect(service.getCompany(asClient(client), MANAGER)).resolves.toMatchObject({ companyName: '' })
    })
  })

  describe('upsertCompany', () => {
    it('forbids a non-ADMIN (HR) from writing company settings', async () => {
      await expect(service.upsertCompany(asClient(client), HR, { companyName: 'X' })).rejects.toThrow(ForbiddenException)
      expect(client.companySettings.create).not.toHaveBeenCalled()
      expect(client.companySettings.update).not.toHaveBeenCalled()
    })

    it('forbids a MANAGER from writing company settings', async () => {
      await expect(service.upsertCompany(asClient(client), MANAGER, { companyName: 'X' })).rejects.toThrow(ForbiddenException)
    })

    it('updates the existing singleton by id and audits settings.updated', async () => {
      const before = { id: 'cs1', companyName: 'Old' }
      client.companySettings.findFirst.mockResolvedValue(before)
      const after = { id: 'cs1', companyName: 'New' }
      client.companySettings.update.mockResolvedValue(after)

      const result = await service.upsertCompany(asClient(client), ADMIN, { companyName: 'New' })

      expect(result).toBe(after)
      expect(client.companySettings.update).toHaveBeenCalledWith({ where: { id: 'cs1' }, data: { companyName: 'New' } })
      expect(client.companySettings.create).not.toHaveBeenCalled()
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'settings.updated', entityId: 'cs1', payload: { before, after } }),
      )
    })

    it('creates the singleton when none exists, given a non-empty companyName', async () => {
      client.companySettings.findFirst.mockResolvedValue(null)
      client.companySettings.create.mockResolvedValue({ id: 'cs-new', companyName: 'Acme', timezone: 'UTC' })

      await service.upsertCompany(asClient(client), ADMIN, { companyName: 'Acme', timezone: 'UTC' })

      expect(client.companySettings.create).toHaveBeenCalledWith({ data: { companyName: 'Acme', timezone: 'UTC' } })
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'settings.updated', entityId: 'cs-new' }))
    })

    it('rejects the first create with a 400 when companyName is absent (empty body)', async () => {
      client.companySettings.findFirst.mockResolvedValue(null)

      await expect(service.upsertCompany(asClient(client), ADMIN, {})).rejects.toThrow(BadRequestException)
      expect(client.companySettings.create).not.toHaveBeenCalled()
      expect(client.companySettings.update).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('rejects the first create with a 400 when companyName is blank/whitespace', async () => {
      client.companySettings.findFirst.mockResolvedValue(null)

      await expect(service.upsertCompany(asClient(client), ADMIN, { companyName: '   ' })).rejects.toThrow(BadRequestException)
      expect(client.companySettings.create).not.toHaveBeenCalled()
    })

    it('rejects a no-op empty-body update on an existing row with a 400', async () => {
      client.companySettings.findFirst.mockResolvedValue({ id: 'cs1', companyName: 'Acme' })

      await expect(service.upsertCompany(asClient(client), ADMIN, {})).rejects.toThrow(BadRequestException)
      expect(client.companySettings.update).not.toHaveBeenCalled()
      expect(client.companySettings.create).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('allows a genuine partial update on an existing row (only the given field changes)', async () => {
      const before = { id: 'cs1', companyName: 'Acme', timezone: 'Europe/Warsaw' }
      client.companySettings.findFirst.mockResolvedValue(before)
      const after = { id: 'cs1', companyName: 'Acme', timezone: 'UTC' }
      client.companySettings.update.mockResolvedValue(after)

      const result = await service.upsertCompany(asClient(client), ADMIN, { timezone: 'UTC' })

      expect(result).toBe(after)
      expect(client.companySettings.update).toHaveBeenCalledWith({ where: { id: 'cs1' }, data: { timezone: 'UTC' } })
    })

    it('recovers from a P2002 race on the first create by re-reading and updating (no dup)', async () => {
      client.companySettings.findFirst
        .mockResolvedValueOnce(null) // `before` lookup: this actor sees no row
        .mockResolvedValueOnce({ id: 'cs-existing' }) // re-read after the losing create P2002s
      client.companySettings.create.mockRejectedValue({ code: 'P2002' })
      client.companySettings.update.mockResolvedValue({ id: 'cs-existing', companyName: 'Acme' })

      const result = await service.upsertCompany(asClient(client), ADMIN, { companyName: 'Acme' })

      expect(client.companySettings.update).toHaveBeenCalledWith({ where: { id: 'cs-existing' }, data: { companyName: 'Acme' } })
      expect(result).toEqual({ id: 'cs-existing', companyName: 'Acme' })
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'settings.updated' }))
    })
  })

  describe('listUnits', () => {
    it('projects units with derived direct-children id arrays', async () => {
      client.organizationalUnit.findMany.mockResolvedValue([
        { id: 'root', name: 'Root', parentId: null, managerUserId: 'u1' },
        { id: 'a', name: 'A', parentId: 'root', managerUserId: null },
        { id: 'b', name: 'B', parentId: 'root', managerUserId: null },
        { id: 'a1', name: 'A1', parentId: 'a', managerUserId: null },
      ])

      const result = await service.listUnits(asClient(client), MANAGER)

      expect(result).toEqual([
        { id: 'root', name: 'Root', parentId: null, managerUserId: 'u1', children: ['a', 'b'] },
        { id: 'a', name: 'A', parentId: 'root', managerUserId: null, children: ['a1'] },
        { id: 'b', name: 'B', parentId: 'root', managerUserId: null, children: [] },
        { id: 'a1', name: 'A1', parentId: 'a', managerUserId: null, children: [] },
      ])
    })
  })

  describe('createUnit', () => {
    it('forbids a non-ADMIN (HR)', async () => {
      await expect(service.createUnit(asClient(client), HR, { name: 'Unit' })).rejects.toThrow(ForbiddenException)
      expect(client.organizationalUnit.create).not.toHaveBeenCalled()
    })

    it('creates a unit and audits unit.created', async () => {
      const created = { id: 'unit-1', name: 'Unit', parentId: null }
      client.organizationalUnit.create.mockResolvedValue(created)

      const result = await service.createUnit(asClient(client), ADMIN, { name: 'Unit' })

      expect(result).toBe(created)
      expect(client.organizationalUnit.create).toHaveBeenCalledWith({ data: { name: 'Unit', parentId: null } })
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'unit.created', entityType: 'OrganizationalUnit', entityId: 'unit-1' }),
      )
    })

    it('maps a bad parentId FK (P2003) to a 400', async () => {
      client.organizationalUnit.create.mockRejectedValue({ code: 'P2003' })

      await expect(service.createUnit(asClient(client), ADMIN, { name: 'Unit', parentId: 'nope' })).rejects.toThrow(BadRequestException)
    })
  })

  describe('updateUnit', () => {
    it('forbids a non-ADMIN (HR)', async () => {
      await expect(service.updateUnit(asClient(client), HR, 'unit-1', { name: 'X' })).rejects.toThrow(ForbiddenException)
    })

    it('404s when the unit does not exist', async () => {
      client.organizationalUnit.findUnique.mockResolvedValue(null)

      await expect(service.updateUnit(asClient(client), ADMIN, 'ghost', { name: 'X' })).rejects.toThrow(NotFoundException)
    })

    it('renames a unit and audits unit.updated', async () => {
      const before = { id: 'unit-1', name: 'Old', parentId: null, managerUserId: null }
      client.organizationalUnit.findUnique.mockResolvedValue(before)
      const after = { id: 'unit-1', name: 'New', parentId: null, managerUserId: null }
      client.organizationalUnit.update.mockResolvedValue(after)

      const result = await service.updateUnit(asClient(client), ADMIN, 'unit-1', { name: 'New' })

      expect(result).toBe(after)
      expect(client.organizationalUnit.update).toHaveBeenCalledWith({ where: { id: 'unit-1' }, data: { name: 'New' } })
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'unit.updated', entityId: 'unit-1', payload: { before, after } }),
      )
    })

    it('rejects a self-parent reparent (cycle) with a 400', async () => {
      client.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-1', name: 'U', parentId: null, managerUserId: null })

      await expect(service.updateUnit(asClient(client), ADMIN, 'unit-1', { parentId: 'unit-1' })).rejects.toThrow(BadRequestException)
      expect(client.organizationalUnit.update).not.toHaveBeenCalled()
    })

    it('rejects reparenting under a descendant (cycle) with a 400', async () => {
      // Tree: unit-1 -> child. Trying to set unit-1.parent = child would make unit-1 its own ancestor.
      const moved = { id: 'unit-1', name: 'U', parentId: null, managerUserId: null }
      client.organizationalUnit.findUnique
        .mockResolvedValueOnce(moved) // initial load of the moved node
        .mockResolvedValueOnce({ parentId: 'unit-1' }) // walking up from proposed parent `child` → reaches unit-1

      await expect(service.updateUnit(asClient(client), ADMIN, 'unit-1', { parentId: 'child' })).rejects.toThrow(BadRequestException)
      expect(client.organizationalUnit.update).not.toHaveBeenCalled()
    })

    it('allows a valid reparent to an unrelated node', async () => {
      const before = { id: 'unit-1', name: 'U', parentId: null, managerUserId: null }
      client.organizationalUnit.findUnique
        .mockResolvedValueOnce(before) // initial load
        .mockResolvedValueOnce({ parentId: null }) // proposed parent `other` is a root → chain ends, no cycle
      const after = { id: 'unit-1', name: 'U', parentId: 'other', managerUserId: null }
      client.organizationalUnit.update.mockResolvedValue(after)

      const result = await service.updateUnit(asClient(client), ADMIN, 'unit-1', { parentId: 'other' })

      expect(result).toBe(after)
      expect(client.organizationalUnit.update).toHaveBeenCalledWith({ where: { id: 'unit-1' }, data: { parentId: 'other' } })
    })

    it('maps a bad managerUserId FK (P2003) to a 400', async () => {
      client.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-1', name: 'U', parentId: null, managerUserId: null })
      client.organizationalUnit.update.mockRejectedValue({ code: 'P2003' })

      await expect(service.updateUnit(asClient(client), ADMIN, 'unit-1', { managerUserId: 'ghost' })).rejects.toThrow(BadRequestException)
    })
  })
})
