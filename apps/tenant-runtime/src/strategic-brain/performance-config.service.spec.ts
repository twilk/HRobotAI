import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { PerformanceConfigService, configHash } from './performance-config.service.js'

/** A mock tenant client exposing exactly the delegate PerformanceConfigService touches (mirrors
 * ai-config.service.spec's `makeClient`). */
function makeClient() {
  return {
    performanceConfig: { findFirst: jest.fn(), upsert: jest.fn(), update: jest.fn(), create: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

/** The schema column defaults (Task 1 migration) — kept here as a literal so a drift between the
 * service's synthetic default and the Prisma schema fails loudly in this spec. */
const SCHEMA_DEFAULTS = {
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
  proactivityLevel: 'PROAKTYWNE_REKOMENDACJE',
}

describe('PerformanceConfigService', () => {
  let service: PerformanceConfigService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceConfigService],
    }).compile()
    service = module.get(PerformanceConfigService)
    client = makeClient()
    jest.clearAllMocks()
  })

  describe('getEffectiveConfig', () => {
    it("returns the unit's own row when present, without ever reading the global row", async () => {
      const row = { id: 'cfg-A', unitId: 'unit-A', weightPerformance: 0.4 }
      client.performanceConfig.findFirst.mockResolvedValueOnce(row)

      const result = await service.getEffectiveConfig(asClient(client), 'unit-A')

      expect(result).toBe(row)
      expect(client.performanceConfig.findFirst).toHaveBeenCalledTimes(1)
      expect(client.performanceConfig.findFirst).toHaveBeenCalledWith({ where: { unitId: 'unit-A' } })
    })

    it('falls back to the tenant-wide default (null-unit) row when the unit has no row of its own', async () => {
      const globalRow = { id: 'cfg-default', unitId: null, weightPerformance: 0.35 }
      client.performanceConfig.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(globalRow)

      const result = await service.getEffectiveConfig(asClient(client), 'unit-A')

      expect(result).toBe(globalRow)
      expect(client.performanceConfig.findFirst).toHaveBeenNthCalledWith(1, { where: { unitId: 'unit-A' } })
      expect(client.performanceConfig.findFirst).toHaveBeenNthCalledWith(2, { where: { unitId: null } })
    })

    it('falls back to a synthetic default matching the schema defaults when neither a unit nor a global row exists', async () => {
      client.performanceConfig.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

      const result = await service.getEffectiveConfig(asClient(client), 'unit-A')

      expect(result).toEqual({ unitId: 'unit-A', ...SCHEMA_DEFAULTS })
    })

    it('for unitId = null, goes straight to the global row — never a unit lookup', async () => {
      const globalRow = { id: 'cfg-default', unitId: null }
      client.performanceConfig.findFirst.mockResolvedValueOnce(globalRow)

      const result = await service.getEffectiveConfig(asClient(client), null)

      expect(result).toBe(globalRow)
      expect(client.performanceConfig.findFirst).toHaveBeenCalledTimes(1)
      expect(client.performanceConfig.findFirst).toHaveBeenCalledWith({ where: { unitId: null } })
    })

    it('returns the synthetic default with unitId: null when unitId is null and no global row exists', async () => {
      client.performanceConfig.findFirst.mockResolvedValueOnce(null)

      const result = await service.getEffectiveConfig(asClient(client), null)

      expect(result).toEqual({ unitId: null, ...SCHEMA_DEFAULTS })
    })
  })

  describe('upsertConfig — weight-sum validation', () => {
    const validWeights = { weightPerformance: 0.3, weightTimeliness: 0.25, weightQuality: 0.25, weightDevelopment: 0.2 }

    it('throws BadRequestException when the four weights do not sum to 1.00', async () => {
      await expect(
        service.upsertConfig(asClient(client), { unitId: 'unit-A', ...validWeights, weightPerformance: 0.5 }),
      ).rejects.toThrow(BadRequestException)
      expect(client.performanceConfig.upsert).not.toHaveBeenCalled()
      expect(client.performanceConfig.create).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when only some of the four weights are supplied (ambiguous partial change)', async () => {
      await expect(
        service.upsertConfig(asClient(client), { unitId: 'unit-A', weightPerformance: 0.4 }),
      ).rejects.toThrow(BadRequestException)
      expect(client.performanceConfig.upsert).not.toHaveBeenCalled()
    })

    it('accepts weights that sum to 1.00 within floating-point epsilon', async () => {
      const after = { id: 'cfg-A', unitId: 'unit-A', ...validWeights }
      client.performanceConfig.upsert.mockResolvedValue(after)

      // 0.1 + 0.2 + 0.3 + 0.4 !== 1 exactly in IEEE754 — must still pass.
      const result = await service.upsertConfig(asClient(client), {
        unitId: 'unit-A',
        weightPerformance: 0.1,
        weightTimeliness: 0.2,
        weightQuality: 0.3,
        weightDevelopment: 0.4,
      })

      expect(result).toBe(after)
      expect(client.performanceConfig.upsert).toHaveBeenCalled()
    })

    it('skips weight validation entirely when no weight field is present in the update', async () => {
      client.performanceConfig.findFirst.mockResolvedValue({ id: 'cfg-default', unitId: null })
      client.performanceConfig.update.mockResolvedValue({ id: 'cfg-default', unitId: null, slaTargetMinutes: 90 })

      await service.upsertConfig(asClient(client), { slaTargetMinutes: 90 })

      expect(client.performanceConfig.update).toHaveBeenCalledWith({ where: { id: 'cfg-default' }, data: { slaTargetMinutes: 90 } })
    })
  })

  describe('upsertConfig — real unit (unitId set)', () => {
    it('upserts a real unit config via the @@unique([unitId]) key', async () => {
      const validWeights = { weightPerformance: 0.3, weightTimeliness: 0.25, weightQuality: 0.25, weightDevelopment: 0.2 }
      const after = { id: 'cfg-A', unitId: 'unit-A', ...validWeights }
      client.performanceConfig.upsert.mockResolvedValue(after)

      const result = await service.upsertConfig(asClient(client), { unitId: 'unit-A', ...validWeights })

      expect(result).toBe(after)
      expect(client.performanceConfig.upsert).toHaveBeenCalledWith({
        where: { unitId: 'unit-A' },
        update: validWeights,
        create: { ...validWeights, unitId: 'unit-A' },
      })
    })
  })

  describe('upsertConfig — nullable default row (unitId undefined, mirrors AiConfigService.upsertConfig)', () => {
    it('creates the tenant-wide default row via create (not upsert) when none exists yet', async () => {
      client.performanceConfig.findFirst.mockResolvedValue(null)
      client.performanceConfig.create.mockResolvedValue({ id: 'cfg-default', unitId: null, slaTargetMinutes: 90 })

      const result = await service.upsertConfig(asClient(client), { slaTargetMinutes: 90 })

      expect(client.performanceConfig.upsert).not.toHaveBeenCalled()
      expect(client.performanceConfig.create).toHaveBeenCalledWith({ data: { slaTargetMinutes: 90, unitId: null } })
      expect(result).toEqual({ id: 'cfg-default', unitId: null, slaTargetMinutes: 90 })
    })

    it('updates the existing tenant-wide default row by id when one already exists', async () => {
      client.performanceConfig.findFirst.mockResolvedValue({ id: 'cfg-default', unitId: null })
      client.performanceConfig.update.mockResolvedValue({ id: 'cfg-default', unitId: null, slaTargetMinutes: 60 })

      await service.upsertConfig(asClient(client), { slaTargetMinutes: 60 })

      expect(client.performanceConfig.create).not.toHaveBeenCalled()
      expect(client.performanceConfig.update).toHaveBeenCalledWith({ where: { id: 'cfg-default' }, data: { slaTargetMinutes: 60 } })
    })

    it('recovers from a P2002 race on the null-default create by re-reading and updating instead of throwing (B1)', async () => {
      // Two concurrent first-writes race; this caller loses — mirrors ai-config.service.ts:106-126.
      client.performanceConfig.findFirst
        .mockResolvedValueOnce(null) // `before` lookup finds nothing
        .mockResolvedValueOnce({ id: 'cfg-default', unitId: null }) // re-read after P2002
      client.performanceConfig.create.mockRejectedValue({ code: 'P2002' })
      client.performanceConfig.update.mockResolvedValue({ id: 'cfg-default', unitId: null, slaTargetMinutes: 45 })

      const result = await service.upsertConfig(asClient(client), { slaTargetMinutes: 45 })

      expect(client.performanceConfig.update).toHaveBeenCalledWith({ where: { id: 'cfg-default' }, data: { slaTargetMinutes: 45 } })
      expect(result).toEqual({ id: 'cfg-default', unitId: null, slaTargetMinutes: 45 })
    })

    it('surfaces ConflictException if the P2002 re-read still finds no default row (should never happen, but must not swallow)', async () => {
      client.performanceConfig.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      client.performanceConfig.create.mockRejectedValue({ code: 'P2002' })

      await expect(service.upsertConfig(asClient(client), { slaTargetMinutes: 45 })).rejects.toThrow(ConflictException)
    })

    it('re-throws non-P2002 errors from create without recovery', async () => {
      client.performanceConfig.findFirst.mockResolvedValueOnce(null)
      client.performanceConfig.create.mockRejectedValue(new Error('boom'))

      await expect(service.upsertConfig(asClient(client), { slaTargetMinutes: 45 })).rejects.toThrow('boom')
      expect(client.performanceConfig.update).not.toHaveBeenCalled()
    })
  })

  describe('configHash', () => {
    const base = {
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
    }

    it('is deterministic — the same config produces the same hash every time', () => {
      expect(configHash(base)).toBe(configHash({ ...base }))
    })

    it('is insensitive to key order (pure function of VALUES, not object identity/order)', () => {
      const reordered = {
        minPeerGroupSize: base.minPeerGroupSize,
        weightDevelopment: base.weightDevelopment,
        weightPerformance: base.weightPerformance,
        weightTimeliness: base.weightTimeliness,
        weightQuality: base.weightQuality,
        slaTargetMinutes: base.slaTargetMinutes,
        defectThreshold: base.defectThreshold,
        confidenceMinDays: base.confidenceMinDays,
        windowDays: base.windowDays,
        minValidWindows: base.minValidWindows,
        minSlopeForGrowth: base.minSlopeForGrowth,
      }
      expect(configHash(reordered)).toBe(configHash(base))
    })

    it('changes when any single weight changes', () => {
      expect(configHash({ ...base, weightPerformance: 0.31 })).not.toBe(configHash(base))
    })

    it('changes when a non-weight threshold changes (e.g. slaTargetMinutes)', () => {
      expect(configHash({ ...base, slaTargetMinutes: 90 })).not.toBe(configHash(base))
    })
  })
})
