import { Test, TestingModule } from '@nestjs/testing'
import { ForbiddenException, BadRequestException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { EmploymentType, Role } from '@hrobot/shared'
import { CostService, type CostActor } from './cost.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { AiConfigService } from '../ai-grafik/ai-config.service.js'

/** A mock tenant client exposing exactly the delegates CostService touches. */
function makeClient() {
  return {
    positionCostRate: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    shift: { findMany: jest.fn() },
    userRole: { findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const HR: CostActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const ADMIN: CostActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.2' }
const MANAGER: CostActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.3' }

/** A minimal PositionCostRate row, as Prisma would return it. */
function rateRow(overrides: Partial<{ position: string; employmentType: EmploymentType; hourlyRate: string; currency: string }> = {}) {
  return {
    id: `rate-${overrides.position ?? 'Kasjer'}-${overrides.employmentType ?? EmploymentType.UMOWA_O_PRACE}`,
    position: 'Kasjer',
    employmentType: EmploymentType.UMOWA_O_PRACE,
    hourlyRate: '30',
    overtimeMultiplier: '1.5',
    currency: 'PLN',
    ...overrides,
  }
}

/** A minimal shift-with-employee row, as `weekCost`'s select projects it. */
function shiftRow(overrides: Partial<{ employeeId: string; start: string; end: string; position: string; employmentType: EmploymentType }> = {}) {
  const { position = 'Kasjer', employmentType = EmploymentType.UMOWA_O_PRACE, employeeId = 'emp-1', start = '08:00', end = '16:00' } = overrides
  return { employeeId, start, end, employee: { position, employmentType } }
}

describe('CostService', () => {
  let service: CostService
  let audit: { log: jest.Mock }
  let aiConfig: { getEffectiveBudgetCap: jest.Mock }
  let client: MockClient

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    aiConfig = { getEffectiveBudgetCap: jest.fn().mockResolvedValue({ cap: null, source: 'none' }) }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostService,
        { provide: AuditService, useValue: audit },
        { provide: AiConfigService, useValue: aiConfig },
      ],
    }).compile()
    service = module.get(CostService)
    client = makeClient()
    jest.clearAllMocks()
  })

  // ----------------------------------------------------------------------------------------------
  // shiftCost — PURE hours × hourlyRate, overnight/zero-length semantics, NO overtime.
  // ----------------------------------------------------------------------------------------------
  describe('shiftCost', () => {
    it('computes hours × hourlyRate for a same-day shift', () => {
      const cost = service.shiftCost({ hourlyRate: '30' }, { start: '08:00', end: '16:00' })
      expect(cost.toFixed(2)).toBe('240.00') // 8h × 30
    })

    it('adds 24h for an overnight shift where end < start', () => {
      const cost = service.shiftCost({ hourlyRate: '20' }, { start: '22:00', end: '06:00' })
      expect(cost.toFixed(2)).toBe('160.00') // 8h × 20
    })

    it('treats end === start as a 0h (invalid) shift, NOT a 24h shift', () => {
      const cost = service.shiftCost({ hourlyRate: '50' }, { start: '08:00', end: '08:00' })
      expect(cost.toFixed(2)).toBe('0.00')
    })

    it('ignores overtimeMultiplier entirely — MVP has no overtime concept', () => {
      const cost = service.shiftCost({ hourlyRate: '30', overtimeMultiplier: '2' } as never, { start: '08:00', end: '16:00' })
      expect(cost.toFixed(2)).toBe('240.00') // same as without the multiplier field
    })
  })

  // ----------------------------------------------------------------------------------------------
  // getRates / upsertRate
  // ----------------------------------------------------------------------------------------------
  describe('getRates', () => {
    it('returns all rates ordered by position then employmentType', async () => {
      const rows = [rateRow()]
      client.positionCostRate.findMany.mockResolvedValue(rows)

      const result = await service.getRates(asClient(client))

      expect(result).toBe(rows)
      expect(client.positionCostRate.findMany).toHaveBeenCalledWith({
        orderBy: [{ position: 'asc' }, { employmentType: 'asc' }],
      })
    })
  })

  describe('upsertRate', () => {
    it('forbids a MANAGER from writing a rate (Codex P1-1 — HR/ADMIN only, never MANAGER)', async () => {
      await expect(
        service.upsertRate(asClient(client), MANAGER, { position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE, hourlyRate: '30' }),
      ).rejects.toThrow(ForbiddenException)
      expect(client.positionCostRate.upsert).not.toHaveBeenCalled()
    })

    it('lets HR write a rate', async () => {
      client.positionCostRate.findUnique.mockResolvedValue(null)
      const after = rateRow()
      client.positionCostRate.upsert.mockResolvedValue(after)

      const result = await service.upsertRate(asClient(client), HR, { position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE, hourlyRate: '30' })

      expect(result).toBe(after)
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'position_cost_rate.upserted', entityType: 'PositionCostRate' }))
    })

    it('lets ADMIN_KLIENTA write a rate', async () => {
      client.positionCostRate.findUnique.mockResolvedValue(null)
      client.positionCostRate.upsert.mockResolvedValue(rateRow())

      await expect(
        service.upsertRate(asClient(client), ADMIN, { position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE, hourlyRate: '30' }),
      ).resolves.toBeDefined()
    })

    it('(Codex P1-5) normalizes position — trims and collapses internal whitespace — before writing', async () => {
      client.positionCostRate.findUnique.mockResolvedValue(null)
      client.positionCostRate.upsert.mockResolvedValue(rateRow())

      await service.upsertRate(asClient(client), HR, { position: '  Kasjer   zmianowy  ', employmentType: EmploymentType.UMOWA_O_PRACE, hourlyRate: '30' })

      expect(client.positionCostRate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { position_employmentType: { position: 'Kasjer zmianowy', employmentType: EmploymentType.UMOWA_O_PRACE } },
        }),
      )
    })

    it('rejects a position that normalizes to blank', async () => {
      await expect(
        service.upsertRate(asClient(client), HR, { position: '   ', employmentType: EmploymentType.UMOWA_O_PRACE, hourlyRate: '30' }),
      ).rejects.toThrow(BadRequestException)
      expect(client.positionCostRate.upsert).not.toHaveBeenCalled()
    })

    it('defaults currency to PLN when omitted', async () => {
      client.positionCostRate.findUnique.mockResolvedValue(null)
      client.positionCostRate.upsert.mockResolvedValue(rateRow())

      await service.upsertRate(asClient(client), HR, { position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE, hourlyRate: '30' })

      expect(client.positionCostRate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ currency: 'PLN' }) }),
      )
    })
  })

  // ----------------------------------------------------------------------------------------------
  // weekCost
  // ----------------------------------------------------------------------------------------------
  describe('weekCost', () => {
    const WEEK_START = new Date('2026-07-15T00:00:00.000Z') // any day inside Mon 07-13 .. Sun 07-19

    it('sums shift costs for shifts with a matching rate', async () => {
      client.shift.findMany.mockResolvedValue([
        shiftRow({ start: '08:00', end: '16:00' }), // 8h
        shiftRow({ employeeId: 'emp-2', start: '08:00', end: '12:00' }), // 4h
      ])
      client.positionCostRate.findMany.mockResolvedValue([rateRow({ hourlyRate: '30' })])

      const result = await service.weekCost(asClient(client), HR, { weekStart: WEEK_START })

      expect(result).toEqual({ cost: '360.00', currency: 'PLN', missingRates: [], currencyConflict: false }) // (8+4)h × 30
    })

    it('(Codex P1-5) normalizes Employee.position at lookup so whitespace does not cause a miss', async () => {
      client.shift.findMany.mockResolvedValue([shiftRow({ position: '  Kasjer  zmianowy ' })])
      client.positionCostRate.findMany.mockResolvedValue([rateRow({ position: 'Kasjer zmianowy', hourlyRate: '10' })])

      const result = await service.weekCost(asClient(client), HR, { weekStart: WEEK_START })

      expect(result.missingRates).toEqual([])
      expect(result.cost).toBe('80.00') // 8h × 10
      expect(client.positionCostRate.findMany).toHaveBeenCalledWith({
        where: { OR: [{ position: 'Kasjer zmianowy', employmentType: EmploymentType.UMOWA_O_PRACE }] },
      })
    })

    it('(Codex Open-Q missing rate) never treats a missing rate as 0 — reports it in missingRates instead', async () => {
      client.shift.findMany.mockResolvedValue([
        shiftRow({ employeeId: 'emp-1', position: 'Kucharz', employmentType: EmploymentType.B2B }),
        shiftRow({ employeeId: 'emp-2', position: 'Kucharz', employmentType: EmploymentType.B2B }),
      ])
      client.positionCostRate.findMany.mockResolvedValue([]) // no rate for Kucharz/B2B

      const result = await service.weekCost(asClient(client), HR, { weekStart: WEEK_START })

      expect(result.cost).toBe('0.00')
      expect(result.missingRates).toEqual([
        { position: 'Kucharz', employmentType: EmploymentType.B2B, employeeIds: ['emp-1', 'emp-2'] },
      ])
    })

    it('mixes a missing-rate shift with a rated shift — the rated one still counts, the other is reported missing', async () => {
      client.shift.findMany.mockResolvedValue([
        shiftRow({ employeeId: 'emp-1', position: 'Kasjer', start: '08:00', end: '16:00' }),
        shiftRow({ employeeId: 'emp-2', position: 'Kucharz', employmentType: EmploymentType.B2B }),
      ])
      client.positionCostRate.findMany.mockResolvedValue([rateRow({ hourlyRate: '30' })])

      const result = await service.weekCost(asClient(client), HR, { weekStart: WEEK_START })

      expect(result.cost).toBe('240.00')
      expect(result.missingRates).toEqual([{ position: 'Kucharz', employmentType: EmploymentType.B2B, employeeIds: ['emp-2'] }])
    })

    it('(Codex Open-Q currency) refuses to sum a mixed-currency rate set — currencyConflict, cost null', async () => {
      client.shift.findMany.mockResolvedValue([
        shiftRow({ employeeId: 'emp-1', position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE }),
        shiftRow({ employeeId: 'emp-2', position: 'Kierownik', employmentType: EmploymentType.B2B }),
      ])
      client.positionCostRate.findMany.mockResolvedValue([
        rateRow({ position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE, currency: 'PLN' }),
        rateRow({ position: 'Kierownik', employmentType: EmploymentType.B2B, currency: 'EUR' }),
      ])

      const result = await service.weekCost(asClient(client), HR, { weekStart: WEEK_START })

      expect(result).toEqual({ cost: null, currency: null, missingRates: [], currencyConflict: true })
    })

    it('returns a zero result without querying rates when there are no shifts in scope', async () => {
      client.shift.findMany.mockResolvedValue([])

      const result = await service.weekCost(asClient(client), HR, { weekStart: WEEK_START })

      expect(result).toEqual({ cost: '0.00', currency: null, missingRates: [], currencyConflict: false })
      expect(client.positionCostRate.findMany).not.toHaveBeenCalled()
    })

    it('scopes shifts to the given unit', async () => {
      client.shift.findMany.mockResolvedValue([])

      await service.weekCost(asClient(client), HR, { weekStart: WEEK_START, unitId: 'unit-A' })

      expect(client.shift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ employee: { unitId: 'unit-A' } }) }),
      )
    })

    describe('RBAC scoping (Codex P1-3)', () => {
      it('requires a unitId for a MANAGER view', async () => {
        await expect(service.weekCost(asClient(client), MANAGER, { weekStart: WEEK_START })).rejects.toThrow(ForbiddenException)
        expect(client.shift.findMany).not.toHaveBeenCalled()
      })

      it('forbids a MANAGER from reading a unit outside their managed set', async () => {
        client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])

        await expect(service.weekCost(asClient(client), MANAGER, { weekStart: WEEK_START, unitId: 'other' })).rejects.toThrow(
          ForbiddenException,
        )
        expect(client.shift.findMany).not.toHaveBeenCalled()
      })

      it('lets a MANAGER read their own managed unit', async () => {
        client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
        client.shift.findMany.mockResolvedValue([])

        await expect(service.weekCost(asClient(client), MANAGER, { weekStart: WEEK_START, unitId: 'unit-A' })).resolves.toBeDefined()
      })

      it('lets a global actor (HR) read any unit, or the tenant-wide view, without a managed-unit lookup', async () => {
        client.shift.findMany.mockResolvedValue([])

        await service.weekCost(asClient(client), HR, { weekStart: WEEK_START })

        expect(client.userRole.findMany).not.toHaveBeenCalled()
      })
    })
  })

  // ----------------------------------------------------------------------------------------------
  // budgetStatus
  // ----------------------------------------------------------------------------------------------
  describe('budgetStatus', () => {
    const WEEK_START = new Date('2026-07-15T00:00:00.000Z')

    it('reports overBudget=false when the cost is under the effective cap and no rate is missing', async () => {
      client.shift.findMany.mockResolvedValue([shiftRow({ start: '08:00', end: '16:00' })])
      client.positionCostRate.findMany.mockResolvedValue([rateRow({ hourlyRate: '10' })]) // 8h×10=80
      aiConfig.getEffectiveBudgetCap.mockResolvedValue({ cap: '1000', source: 'unit' })

      const result = await service.budgetStatus(asClient(client), HR, 'unit-A', WEEK_START)

      expect(result).toEqual({ cost: '80.00', currency: 'PLN', missingRates: [], currencyConflict: false, cap: '1000', overBudget: false })
    })

    it('reports overBudget=true when the known cost already exceeds the cap', async () => {
      client.shift.findMany.mockResolvedValue([shiftRow({ start: '08:00', end: '20:00' })]) // 12h
      client.positionCostRate.findMany.mockResolvedValue([rateRow({ hourlyRate: '100' })]) // 1200
      aiConfig.getEffectiveBudgetCap.mockResolvedValue({ cap: '1000', source: 'unit' })

      const result = await service.budgetStatus(asClient(client), HR, 'unit-A', WEEK_START)

      expect(result.overBudget).toBe(true)
    })

    it('(Codex Open-Q missing rate) NEVER asserts overBudget=false while a rate is missing, even if the known partial sum is under cap', async () => {
      client.shift.findMany.mockResolvedValue([shiftRow({ position: 'Kucharz', employmentType: EmploymentType.B2B })])
      client.positionCostRate.findMany.mockResolvedValue([]) // missing
      aiConfig.getEffectiveBudgetCap.mockResolvedValue({ cap: '1000', source: 'unit' })

      const result = await service.budgetStatus(asClient(client), HR, 'unit-A', WEEK_START)

      expect(result.missingRates).toHaveLength(1)
      expect(result.overBudget).toBeNull()
    })

    it('still asserts overBudget=true despite a missing rate when the KNOWN partial sum already exceeds the cap', async () => {
      client.shift.findMany.mockResolvedValue([
        shiftRow({ employeeId: 'emp-1', position: 'Kasjer', start: '00:00', end: '20:00' }), // 20h known
        shiftRow({ employeeId: 'emp-2', position: 'Kucharz', employmentType: EmploymentType.B2B }), // missing
      ])
      client.positionCostRate.findMany.mockResolvedValue([rateRow({ hourlyRate: '100' })]) // 20h×100=2000
      aiConfig.getEffectiveBudgetCap.mockResolvedValue({ cap: '1000', source: 'unit' })

      const result = await service.budgetStatus(asClient(client), HR, 'unit-A', WEEK_START)

      expect(result.missingRates).toHaveLength(1)
      expect(result.overBudget).toBe(true)
    })

    it('reports overBudget=false when there is no cap anywhere (Codex P1-3 "brak capu")', async () => {
      client.shift.findMany.mockResolvedValue([shiftRow({ start: '08:00', end: '16:00' })])
      client.positionCostRate.findMany.mockResolvedValue([rateRow({ hourlyRate: '10' })])
      aiConfig.getEffectiveBudgetCap.mockResolvedValue({ cap: null, source: 'none' })

      const result = await service.budgetStatus(asClient(client), HR, 'unit-A', WEEK_START)

      expect(result.cap).toBeNull()
      expect(result.overBudget).toBe(false)
    })

    it('(Codex Open-Q currency) never asserts an overBudget boolean when there is a currency conflict', async () => {
      client.shift.findMany.mockResolvedValue([
        shiftRow({ employeeId: 'emp-1', position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE }),
        shiftRow({ employeeId: 'emp-2', position: 'Kierownik', employmentType: EmploymentType.B2B }),
      ])
      client.positionCostRate.findMany.mockResolvedValue([
        rateRow({ position: 'Kasjer', employmentType: EmploymentType.UMOWA_O_PRACE, currency: 'PLN' }),
        rateRow({ position: 'Kierownik', employmentType: EmploymentType.B2B, currency: 'EUR' }),
      ])
      aiConfig.getEffectiveBudgetCap.mockResolvedValue({ cap: '1000', source: 'unit' })

      const result = await service.budgetStatus(asClient(client), HR, 'unit-A', WEEK_START)

      expect(result.currencyConflict).toBe(true)
      expect(result.overBudget).toBeNull()
    })

    it('never compares a unit subtotal against the global cap silently — uses getEffectiveBudgetCap with the SAME unitId', async () => {
      client.shift.findMany.mockResolvedValue([])

      await service.budgetStatus(asClient(client), HR, 'unit-A', WEEK_START)

      expect(aiConfig.getEffectiveBudgetCap).toHaveBeenCalledWith(asClient(client), 'unit-A')
    })

    it('resolves the tenant-wide cap (null unitId) for a global HR view with no unit given', async () => {
      client.shift.findMany.mockResolvedValue([])

      await service.budgetStatus(asClient(client), HR, undefined, WEEK_START)

      expect(aiConfig.getEffectiveBudgetCap).toHaveBeenCalledWith(asClient(client), null)
    })
  })
})
