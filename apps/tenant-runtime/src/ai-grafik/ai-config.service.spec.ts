import { Test, TestingModule } from '@nestjs/testing'
import { ForbiddenException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role, AutonomyLevel } from '@hrobot/shared'
import { AiConfigService, type AiConfigActor } from './ai-config.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'

/** A mock tenant client exposing exactly the delegates AiConfigService touches. */
function makeClient() {
  return {
    aiSchedulingConfig: { findFirst: jest.fn(), upsert: jest.fn(), update: jest.fn(), create: jest.fn() },
    userRole: { findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const HR: AiConfigActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const MANAGER: AiConfigActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.3' }
const PRACOWNIK: AiConfigActor = { userId: 'kc-emp', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.4' }

describe('AiConfigService', () => {
  let service: AiConfigService
  let audit: { log: jest.Mock }
  let client: MockClient

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiConfigService, { provide: AuditService, useValue: audit }],
    }).compile()
    service = module.get(AiConfigService)
    client = makeClient()
    jest.clearAllMocks()
  })

  describe('getConfig', () => {
    it('lets a global actor (HR) read any unit config without a scope check', async () => {
      const row = { id: 'cfg1', unitId: 'unit-A', autonomyLevel: AutonomyLevel.AUTO_NOTIFY, consentTtlHours: 12 }
      client.aiSchedulingConfig.findFirst.mockResolvedValue(row)

      const result = await service.getConfig(asClient(client), HR, 'unit-A')

      expect(result).toBe(row)
      expect(client.aiSchedulingConfig.findFirst).toHaveBeenCalledWith({ where: { unitId: 'unit-A' } })
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })

    it('lets a global actor read the tenant-wide default (null unit) when unitId is undefined', async () => {
      client.aiSchedulingConfig.findFirst.mockResolvedValue(null)

      const result = await service.getConfig(asClient(client), HR)

      expect(client.aiSchedulingConfig.findFirst).toHaveBeenCalledWith({ where: { unitId: null } })
      expect(result).toEqual({ autonomyLevel: AutonomyLevel.SUGGEST_ONLY, consentTtlHours: 24, unitId: null })
    })

    it('throws ForbiddenException for a MANAGER reading a unit outside their managed set', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      await expect(service.getConfig(asClient(client), MANAGER, 'other')).rejects.toThrow(ForbiddenException)
      expect(client.aiSchedulingConfig.findFirst).not.toHaveBeenCalled()
    })

    it('returns the SUGGEST_ONLY default when no row exists yet for an in-scope MANAGER', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.aiSchedulingConfig.findFirst.mockResolvedValue(null)

      const result = await service.getConfig(asClient(client), MANAGER, 'unit-A')

      expect(result).toEqual({ autonomyLevel: AutonomyLevel.SUGGEST_ONLY, consentTtlHours: 24, unitId: 'unit-A' })
    })
  })

  describe('upsertConfig', () => {
    it('forbids a plain PRACOWNIK from writing any config (they manage no unit)', async () => {
      client.userRole.findMany.mockResolvedValue([]) // manages nothing

      await expect(
        service.upsertConfig(asClient(client), PRACOWNIK, { autonomyLevel: AutonomyLevel.AUTO_NOTIFY, unitId: 'unit-A' }),
      ).rejects.toThrow(ForbiddenException)
      expect(client.aiSchedulingConfig.findFirst).not.toHaveBeenCalled()
      expect(client.aiSchedulingConfig.upsert).not.toHaveBeenCalled()
    })

    it('forbids a MANAGER from writing a unit outside their managed set', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

      await expect(
        service.upsertConfig(asClient(client), MANAGER, { unitId: 'other', autonomyLevel: AutonomyLevel.AUTO_NOTIFY }),
      ).rejects.toThrow(ForbiddenException)
      expect(client.aiSchedulingConfig.upsert).not.toHaveBeenCalled()
    })

    it('lets a MANAGER upsert their own managed unit and writes an ai_config.updated audit entry', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      client.aiSchedulingConfig.findFirst.mockResolvedValue(null)
      const after = { id: 'cfg-A', unitId: 'unit-A', autonomyLevel: AutonomyLevel.AUTO_NOTIFY }
      client.aiSchedulingConfig.upsert.mockResolvedValue(after)

      const result = await service.upsertConfig(asClient(client), MANAGER, { unitId: 'unit-A', autonomyLevel: AutonomyLevel.AUTO_NOTIFY })

      expect(result).toBe(after)
      expect(client.aiSchedulingConfig.upsert).toHaveBeenCalledWith({
        where: { unitId: 'unit-A' },
        update: { autonomyLevel: AutonomyLevel.AUTO_NOTIFY },
        create: { autonomyLevel: AutonomyLevel.AUTO_NOTIFY, unitId: 'unit-A' },
      })
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai_config.updated', entityId: 'cfg-A' }),
      )
    })

    it('lets HR upsert any unit config', async () => {
      client.aiSchedulingConfig.findFirst.mockResolvedValue({ id: 'cfg-Z', unitId: 'unit-Z' })
      const after = { id: 'cfg-Z', unitId: 'unit-Z', consentTtlHours: 48 }
      client.aiSchedulingConfig.upsert.mockResolvedValue(after)

      await service.upsertConfig(asClient(client), HR, { unitId: 'unit-Z', consentTtlHours: 48 })

      expect(client.userRole.findMany).not.toHaveBeenCalled()
      expect(client.aiSchedulingConfig.upsert).toHaveBeenCalledWith({
        where: { unitId: 'unit-Z' },
        update: { consentTtlHours: 48 },
        create: { consentTtlHours: 48, unitId: 'unit-Z' },
      })
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_config.updated' }))
    })

    it('creates the tenant-wide default row (null unit) via create, not upsert, when none exists', async () => {
      client.aiSchedulingConfig.findFirst.mockResolvedValue(null)
      client.aiSchedulingConfig.create.mockResolvedValue({ id: 'cfg-default', unitId: null })

      await service.upsertConfig(asClient(client), HR, { autonomyLevel: AutonomyLevel.AUTO_ASK_CONSENT })

      expect(client.aiSchedulingConfig.upsert).not.toHaveBeenCalled()
      expect(client.aiSchedulingConfig.create).toHaveBeenCalledWith({
        data: { autonomyLevel: AutonomyLevel.AUTO_ASK_CONSENT, unitId: null },
      })
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_config.updated', entityId: 'cfg-default' }))
    })

    it('updates the existing tenant-wide default row (null unit) by id', async () => {
      client.aiSchedulingConfig.findFirst.mockResolvedValue({ id: 'cfg-default', unitId: null })
      client.aiSchedulingConfig.update.mockResolvedValue({ id: 'cfg-default', unitId: null })

      await service.upsertConfig(asClient(client), HR, { consentTtlHours: 6 })

      expect(client.aiSchedulingConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-default' },
        data: { consentTtlHours: 6 },
      })
    })

    it('recovers from a P2002 race on the null-default create by re-reading and updating instead of throwing', async () => {
      // Both callers see no existing default row and race to `create` it; this actor loses the race.
      client.aiSchedulingConfig.findFirst
        .mockResolvedValueOnce(null) // `before` lookup
        .mockResolvedValueOnce({ id: 'cfg-default', unitId: null }) // re-read after P2002
      client.aiSchedulingConfig.create.mockRejectedValue({ code: 'P2002' })
      client.aiSchedulingConfig.update.mockResolvedValue({ id: 'cfg-default', unitId: null, consentTtlHours: 6 })

      const result = await service.upsertConfig(asClient(client), HR, { consentTtlHours: 6 })

      expect(client.aiSchedulingConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-default' },
        data: { consentTtlHours: 6 },
      })
      expect(result).toEqual({ id: 'cfg-default', unitId: null, consentTtlHours: 6 })
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_config.updated', entityId: 'cfg-default' }))
    })
  })
})
