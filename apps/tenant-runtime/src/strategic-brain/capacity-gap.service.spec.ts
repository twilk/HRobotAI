import { Test, TestingModule } from '@nestjs/testing'
import type { TenantClient } from '@hrobot/db'
import { CapacityGapService, type RoleCapacityGap } from './capacity-gap.service.js'

/** A mock tenant client exposing exactly the delegate CapacityGapService touches (mirrors
 * `grafik.service.spec`'s `makeClient`). */
function makeClient() {
  return {
    shiftDemand: { findMany: jest.fn() },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const LOK = 'lok-1'
const WEEK_START = new Date('2026-07-13T00:00:00.000Z')

describe('CapacityGapService', () => {
  let service: CapacityGapService
  let client: MockClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CapacityGapService],
    }).compile()
    service = module.get(CapacityGapService)
    client = makeClient()
    jest.clearAllMocks()
  })

  it('queries ShiftDemand scoped to the location and the 7-day week window, with linked Shift rows', async () => {
    client.shiftDemand.findMany.mockResolvedValueOnce([])

    await service.capacityGap(asClient(client), LOK, WEEK_START)

    expect(client.shiftDemand.findMany).toHaveBeenCalledTimes(1)
    expect(client.shiftDemand.findMany).toHaveBeenCalledWith({
      where: {
        lokalizacjaId: LOK,
        date: { gte: WEEK_START, lt: new Date('2026-07-20T00:00:00.000Z') },
      },
      include: { shifts: true },
    })
  })

  it('sums requiredCount minus assigned Shift rows (via the demand.shifts relation) per role', async () => {
    client.shiftDemand.findMany.mockResolvedValueOnce([
      // KASJER: two demand rows (different days), 3 required total, 2 assigned total → gap 1.
      { id: 'dem-1', requiredRole: 'KASJER', requiredCount: 2, shifts: [{ id: 's-1' }, { id: 's-2' }] },
      { id: 'dem-2', requiredRole: 'KASJER', requiredCount: 1, shifts: [] },
      // MAGAZYNIER: fully covered → gap 0.
      { id: 'dem-3', requiredRole: 'MAGAZYNIER', requiredCount: 1, shifts: [{ id: 's-3' }] },
    ])

    const result = await service.capacityGap(asClient(client), LOK, WEEK_START)

    expect(result.byRole).toEqual([
      { role: 'KASJER', required: 3, assigned: 2, gap: 1 },
      { role: 'MAGAZYNIER', required: 1, assigned: 1, gap: 0 },
    ])
    expect(result.totalGap).toBe(1)
    expect(result.lokalizacjaId).toBe(LOK)
    expect(result.weekStart).toBe(WEEK_START)
  })

  it('does not clamp at zero — overstaffing (more assigned Shifts than requiredCount) yields a negative gap', async () => {
    client.shiftDemand.findMany.mockResolvedValueOnce([
      { id: 'dem-1', requiredRole: 'KASJER', requiredCount: 1, shifts: [{ id: 's-1' }, { id: 's-2' }] },
    ])

    const result = await service.capacityGap(asClient(client), LOK, WEEK_START)

    expect(result.byRole).toEqual([{ role: 'KASJER', required: 1, assigned: 2, gap: -1 }])
    expect(result.totalGap).toBe(-1)
  })

  it('returns an empty result (no roles, zero total) when the week has no demand rows for the location', async () => {
    client.shiftDemand.findMany.mockResolvedValueOnce([])

    const result = await service.capacityGap(asClient(client), LOK, WEEK_START)

    expect(result.byRole).toEqual([])
    expect(result.totalGap).toBe(0)
  })

  it('is deterministic: identical persisted rows always yield the identical gap (same DB state → same verdict, per B5)', async () => {
    const rows = [{ id: 'dem-1', requiredRole: 'KASJER', requiredCount: 4, shifts: [{ id: 's-1' }] }]
    client.shiftDemand.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows)

    const first = await service.capacityGap(asClient(client), LOK, WEEK_START)
    const second = await service.capacityGap(asClient(client), LOK, WEEK_START)

    expect(second).toEqual(first)
  })

  it('sorts byRole alphabetically for a stable, deterministic shape regardless of DB row order', async () => {
    client.shiftDemand.findMany.mockResolvedValueOnce([
      { id: 'dem-1', requiredRole: 'MAGAZYNIER', requiredCount: 1, shifts: [] },
      { id: 'dem-2', requiredRole: 'KASJER', requiredCount: 1, shifts: [] },
    ])

    const result = await service.capacityGap(asClient(client), LOK, WEEK_START)

    expect(result.byRole.map((r: RoleCapacityGap) => r.role)).toEqual(['KASJER', 'MAGAZYNIER'])
  })
})
