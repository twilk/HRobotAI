import { ForbiddenException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { LeaveStatus, Role } from '@hrobot/shared'
import { AnalitykService, WYMIAR_URLOPU_DNI, type AnalitykActor } from './analityk.service.js'
import { buildRange } from './analityk.range.js'

const HR: AnalitykActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const ADMIN: AnalitykActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.2' }
const MANAGER: AnalitykActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.3' }
const PRACOWNIK: AnalitykActor = { userId: 'kc-emp', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.4' }

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)
const dt = (iso: string): Date => new Date(iso)

/**
 * THE FIXTURE — every expected number in this file is computed BY HAND from the data below, never
 * from the implementation.
 *
 * Range: 2026-06-01 (a Monday) .. 2026-06-14 (a Sunday) = exactly two calendar weeks = 10 working
 * days. Week 1 = 06-01..06-07, week 2 = 06-08..06-14; both lie fully inside the range, so each
 * employee-week carries a full 5-working-day norm.
 */
const RANGE = buildRange('2026-06-01', '2026-06-14')

/** e1,e2 in unit-A; e3,e4 in unit-B. e4's login is deactivated → e4 is NOT current headcount. */
const EMPLOYEES = [
  { id: 'e1', unitId: 'unit-A', hiredAt: d('2025-01-15'), userId: 'u1', etat: 1.0, user: { active: true } },
  { id: 'e2', unitId: 'unit-A', hiredAt: d('2026-06-03'), userId: 'u2', etat: 1.0, user: { active: true } },
  { id: 'e3', unitId: 'unit-B', hiredAt: d('2024-03-01'), userId: 'u3', etat: 0.5, user: { active: true } },
  { id: 'e4', unitId: 'unit-B', hiredAt: d('2023-05-01'), userId: 'u4', etat: 1.0, user: { active: false } },
]

const UNITS = [
  { id: 'unit-A', name: 'Serwis', managerUserId: 'mgr-1' },
  { id: 'unit-B', name: 'Biuro', managerUserId: null },
]

/** Only e4's login was deactivated inside the range → exactly one departure. */
const AUDIT_DEACTIVATIONS = [{ entityId: 'u4', createdAt: dt('2026-06-10T11:00:00.000Z') }]

/**
 * Shifts, all at location `loc-1`.
 *  e1 (etat 1.0, norm 40h/week): week 1 → 5 × 10h = 50h (+10h overtime); week 2 → 4 × 8h = 32h (−8h).
 *  e3 (etat 0.5, norm 20h/week): week 1 → 2 × 10h = 20h (exactly at norm).
 * Totals: 11 shifts, 82h + 20h = 102h, 11 distinct employee-days.
 */
const shift = (employeeId: string, date: string, start: string, end: string, unitId: string, etat: number) => ({
  employeeId,
  date: d(date),
  start,
  end,
  lokalizacjaId: 'loc-1',
  lokalizacja: { name: 'Warszawa' },
  employee: { unitId, etat },
})

const SHIFTS = [
  // e1, week 1 — five 10h days
  shift('e1', '2026-06-01', '08:00', '18:00', 'unit-A', 1.0),
  shift('e1', '2026-06-02', '08:00', '18:00', 'unit-A', 1.0),
  shift('e1', '2026-06-03', '08:00', '18:00', 'unit-A', 1.0),
  shift('e1', '2026-06-04', '08:00', '18:00', 'unit-A', 1.0),
  shift('e1', '2026-06-05', '08:00', '18:00', 'unit-A', 1.0),
  // e1, week 2 — four 8h days
  shift('e1', '2026-06-08', '08:00', '16:00', 'unit-A', 1.0),
  shift('e1', '2026-06-09', '08:00', '16:00', 'unit-A', 1.0),
  shift('e1', '2026-06-10', '08:00', '16:00', 'unit-A', 1.0),
  shift('e1', '2026-06-11', '08:00', '16:00', 'unit-A', 1.0),
  // e3, week 1 — two 10h days
  shift('e3', '2026-06-01', '08:00', '18:00', 'unit-B', 0.5),
  shift('e3', '2026-06-02', '08:00', '18:00', 'unit-B', 0.5),
]

/**
 * APPROVED leave overlapping the range:
 *  L1 e1 06-08..06-12 URLOP_WYPOCZYNKOWY → 5 working days.
 *  L2 e3 05-28..06-02 CHOROBOWE (straddles the start) → only 06-01 + 06-02 = 2 working days.
 *  L3 e2 06-13..06-14 URLOP_NA_ZADANIE (Sat+Sun) → 0 working days, must drop out entirely.
 */
const APPROVED_LEAVES = [
  { employeeId: 'e1', startDate: d('2026-06-08'), endDate: d('2026-06-12'), type: 'URLOP_WYPOCZYNKOWY', employee: { unitId: 'unit-A' } },
  { employeeId: 'e3', startDate: d('2026-05-28'), endDate: d('2026-06-02'), type: 'CHOROBOWE', employee: { unitId: 'unit-B' } },
  { employeeId: 'e2', startDate: d('2026-06-13'), endDate: d('2026-06-14'), type: 'URLOP_NA_ZADANIE', employee: { unitId: 'unit-A' } },
]

/**
 * Every APPROVED leave of the calendar year — the balance query no longer pre-filters by type in
 * SQL, it classifies in memory via `common/leave-type.ts`. The fixture therefore deliberately
 * contains rows that MUST NOT draw the entitlement down (sick, unpaid and maternity leave) plus a
 * lower-cased holiday that the old case-sensitive `startsWith: 'URLOP'` filter silently dropped.
 */
const YEAR_LEAVES = [
  { employeeId: 'e1', startDate: d('2026-06-08'), endDate: d('2026-06-12'), type: 'URLOP_WYPOCZYNKOWY' },
  { employeeId: 'e2', startDate: d('2026-06-13'), endDate: d('2026-06-14'), type: 'URLOP_NA_ZADANIE' },
  { employeeId: 'e3', startDate: d('2026-05-28'), endDate: d('2026-06-02'), type: 'CHOROBOWE' },
  { employeeId: 'e3', startDate: d('2026-03-02'), endDate: d('2026-03-06'), type: 'URLOP_BEZPLATNY' },
  { employeeId: 'e3', startDate: d('2026-04-06'), endDate: d('2026-04-10'), type: 'URLOP_MACIERZYNSKI' },
  { employeeId: 'e2', startDate: d('2026-02-02'), endDate: d('2026-02-04'), type: 'urlop_wypoczynkowy' },
]

/** Requests FILED inside the range: 2 approved, 1 rejected, 1 still pending. */
const FILED_REQUESTS = [
  { id: 'w1', status: LeaveStatus.APPROVED, type: 'URLOP_WYPOCZYNKOWY', createdAt: dt('2026-06-01T09:00:00.000Z'), decidedAt: dt('2026-06-01T15:00:00.000Z'), decidedByUserId: 'mgr-1' }, // 6h
  { id: 'w2', status: LeaveStatus.REJECTED, type: 'URLOP_NA_ZADANIE', createdAt: dt('2026-06-02T09:00:00.000Z'), decidedAt: dt('2026-06-04T09:00:00.000Z'), decidedByUserId: 'mgr-1' }, // 48h
  { id: 'w3', status: LeaveStatus.PENDING, type: 'CHOROBOWE', createdAt: dt('2026-06-10T09:00:00.000Z'), decidedAt: null, decidedByUserId: null },
  { id: 'w4', status: LeaveStatus.APPROVED, type: 'URLOP_WYPOCZYNKOWY', createdAt: dt('2026-06-05T09:00:00.000Z'), decidedAt: dt('2026-06-05T21:00:00.000Z'), decidedByUserId: 'mgr-2' }, // 12h
]

/** Everything still PENDING at the end of the range — p2 was filed BEFORE the range and is stale. */
const PENDING_REQUESTS = [
  { id: 'w3', createdAt: dt('2026-06-10T09:00:00.000Z'), employee: { unitId: 'unit-A' } },
  { id: 'p2', createdAt: dt('2026-05-20T09:00:00.000Z'), employee: { unitId: 'unit-A' } },
  { id: 'p3', createdAt: dt('2026-06-12T09:00:00.000Z'), employee: { unitId: 'unit-B' } },
]

/** A mock tenant client exposing exactly the delegates AnalitykService touches. */
function makeClient() {
  return {
    employee: { findMany: jest.fn().mockResolvedValue(EMPLOYEES) },
    organizationalUnit: { findMany: jest.fn().mockResolvedValue(UNITS) },
    auditLog: { findMany: jest.fn().mockResolvedValue(AUDIT_DEACTIVATIONS) },
    shift: { findMany: jest.fn().mockResolvedValue(SHIFTS) },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: {
      findMany: jest.fn().mockImplementation((args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {}
        // The four leaveRequest queries are told apart by their filters, exactly as the service
        // builds them:
        //   OR[...]        -> the backlog RECONSTRUCTED as of the end of the range,
        //   APPROVED + lte -> the whole-YEAR balance window (startDate lte yearEnd),
        //   APPROVED + lt  -> absences clipped to the range,
        //   otherwise      -> requests filed inside the range.
        if (where.OR) return Promise.resolve(PENDING_REQUESTS)
        if (where.status === LeaveStatus.APPROVED) {
          const startDate = where.startDate as { lte?: Date } | undefined
          return Promise.resolve(startDate?.lte ? YEAR_LEAVES : APPROVED_LEAVES)
        }
        return Promise.resolve(FILED_REQUESTS)
      }),
    },
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

describe('AnalitykService', () => {
  let service: AnalitykService
  let client: MockClient

  beforeEach(() => {
    service = new AnalitykService()
    client = makeClient()
  })

  // --- RBAC ---------------------------------------------------------------------------------------

  describe('resolveScope (RBAC)', () => {
    it('gives HR the whole tenant (null scope) without touching the DB', async () => {
      await expect(service.resolveScope(asClient(client), HR)).resolves.toBeNull()
      expect(client.userRole.findMany).not.toHaveBeenCalled()
    })

    it('gives ADMIN_KLIENTA the whole tenant too', async () => {
      await expect(service.resolveScope(asClient(client), ADMIN)).resolves.toBeNull()
    })

    it('lets a global actor narrow to any single unit', async () => {
      await expect(service.resolveScope(asClient(client), HR, 'unit-B')).resolves.toEqual(['unit-B'])
    })

    it('scopes a MANAGER to the units they manage', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      await expect(service.resolveScope(asClient(client), MANAGER)).resolves.toEqual(['unit-A'])
    })

    it('lets a MANAGER narrow to a unit they DO manage', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }, { unitId: 'unit-C' }])
      await expect(service.resolveScope(asClient(client), MANAGER, 'unit-C')).resolves.toEqual(['unit-C'])
    })

    it('REFUSES a MANAGER asking for a unit they do not manage (403, never another unit’s data)', async () => {
      client.userRole.findMany.mockResolvedValue([{ unitId: 'unit-A' }])
      await expect(service.resolveScope(asClient(client), MANAGER, 'unit-B')).rejects.toThrow(ForbiddenException)
    })

    it('REFUSES a MANAGER who manages nothing instead of silently widening to the tenant', async () => {
      client.userRole.findMany.mockResolvedValue([])
      await expect(service.resolveScope(asClient(client), MANAGER)).rejects.toThrow(ForbiddenException)
    })

    it('REFUSES a plain PRACOWNIK — no managed units means no analytics (defence in depth behind @Roles)', async () => {
      client.userRole.findMany.mockResolvedValue([])
      await expect(service.resolveScope(asClient(client), PRACOWNIK)).rejects.toThrow(ForbiddenException)
    })
  })

  describe('unit scoping is pushed into every query', () => {
    it('filters employees, shifts and leave by the resolved unit list', async () => {
      await service.podsumowanie(asClient(client), ['unit-A'], RANGE)

      const employeeWhere = client.employee.findMany.mock.calls[0][0].where
      expect(employeeWhere).toMatchObject({ unitId: { in: ['unit-A'] } })

      const shiftWhere = client.shift.findMany.mock.calls[0][0].where
      expect(shiftWhere.employee).toEqual({ unitId: { in: ['unit-A'] } })

      const leaveWhere = client.leaveRequest.findMany.mock.calls[0][0].where
      expect(leaveWhere.employee).toEqual({ unitId: { in: ['unit-A'] } })
    })

    it('applies NO unit filter for a global (null) scope', async () => {
      await service.zatrudnienie(asClient(client), null, RANGE)
      const employeeWhere = client.employee.findMany.mock.calls[0][0].where
      expect(employeeWhere.unitId).toBeUndefined()
    })
  })

  // --- 1. Stan zatrudnienia -----------------------------------------------------------------------

  describe('zatrudnienie', () => {
    it('reconstructs headcount at the END of the range from the audit trail', async () => {
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      // e1 + e2 + e3 are on the books; e4's account was switched off on 06-10, inside the range.
      expect(r.stanNaKoniec).toBe(3)
    })

    it('reconstructs headcount at the START of the range — e4 was still employed then', async () => {
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      // At 06-01: e1 + e3 + e4 (deactivated only on 06-10); e2 was not hired until 06-03.
      expect(r.stanNaPoczatek).toBe(3)
    })

    it('lets headcount FALL between two windows — the drop is not structurally impossible', async () => {
      // The window ending BEFORE e4's deactivation still counts e4; the later one does not. Reading
      // the CURRENT `User.active` flag for both (the old behaviour) made this delta non-negative by
      // construction, which is what left `SPADEK_ZATRUDNIENIA` unreachable in production.
      const przed = await service.zatrudnienie(asClient(client), null, buildRange('2026-06-01', '2026-06-09'))
      const po = await service.zatrudnienie(asClient(client), null, buildRange('2026-06-10', '2026-06-14'))
      expect(przed.stanNaKoniec).toBe(4) // e1..e4, e4 still on
      expect(po.stanNaKoniec).toBe(3) // e4 gone
      expect(po.stanNaKoniec - przed.stanNaKoniec).toBeLessThan(0)
    })

    it('counts hires inside the range and departures from the audit log', async () => {
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      expect(r.przyjecia).toBe(1) // only e2 (hired 2026-06-03)
      expect(r.odejscia).toBe(1) // only e4's user.deactivated audit row
      expect(r.zmiana).toBe(0)
      // rotacja W OKRESIE = 1 / ((3+3)/2) = 0.3333 — a RAW period rate, never annualized.
      expect(r.rotacjaWOkresie).toBe(0.3333)
    })

    it('reads the WHOLE deactivation history, unbounded in time — not just the rows inside the range', async () => {
      await service.zatrudnienie(asClient(client), null, RANGE)
      const where = client.auditLog.findMany.mock.calls[0][0].where
      expect(where).toMatchObject({ action: 'user.deactivated', entityType: 'User' })
      // No date bound at all. The headcount AT `od` depends on what happened BEFORE the range, and
      // an account switched off AFTER it must still count as employed inside it — a query cut at
      // `toExcl` would hide that row and strike the person off the books retroactively.
      expect(where.createdAt).toBeUndefined()
    })

    it('reports odejscia/rotacja as UNKNOWN (null), never 0, when no kartoteka has a user account', async () => {
      // Exactly the canonical seed's shape: `SeedEmployee` carries no `userId`, so the audit trail
      // cannot be joined to anybody. A "Rotacja 0%" tile there would be falsely reassuring.
      client.employee.findMany.mockResolvedValue(EMPLOYEES.map((e) => ({ ...e, userId: null })))
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      expect(r.odejscia).toBeNull()
      expect(r.rotacjaWOkresie).toBeNull()
      expect(r.zmiana).toBeNull()
      expect(r.dynamika.every((m) => m.odejscia === null)).toBe(true)
      expect(r.meta.uwagi.join(' ')).toMatch(/NIEZNANE/)
    })

    it('IGNORES a departure whose user is outside the caller’s scope', async () => {
      // A tenant-wide audit row for a user with no employee in scope must not inflate the count.
      client.auditLog.findMany.mockResolvedValue([{ entityId: 'u-someone-else', createdAt: dt('2026-06-05T10:00:00.000Z') }])
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      expect(r.odejscia).toBe(0)
    })

    it('splits active headcount by unit, biggest first, with unit names resolved', async () => {
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      expect(r.wgJednostek).toEqual([
        { unitId: 'unit-A', nazwa: 'Serwis', liczba: 2 },
        { unitId: 'unit-B', nazwa: 'Biuro', liczba: 1 },
      ])
    })

    it('splits by worked location counting each employee ONCE, not once per shift', async () => {
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      // 11 shifts at loc-1, but only e1 and e3 worked them.
      expect(r.wgLokalizacji).toEqual([{ unitId: 'loc-1', nazwa: 'Warszawa', liczba: 2 }])
    })

    it('buckets hire/departure dynamics by month', async () => {
      const r = await service.zatrudnienie(asClient(client), null, RANGE)
      expect(r.dynamika).toEqual([{ miesiac: '2026-06', przyjecia: 1, odejscia: 1 }])
    })
  })

  // --- 2. Absencje --------------------------------------------------------------------------------

  describe('absencje', () => {
    it('sums working days of APPROVED leave, clipping leave that straddles the range boundary', async () => {
      const r = await service.absencje(asClient(client), null, RANGE)
      // L1 = 5 working days, L2 clipped to 2, L3 is a weekend → 0. Total 7.
      expect(r.dniNieobecnosci).toBe(7)
    })

    it('computes the rate against working days × headcount', async () => {
      const r = await service.absencje(asClient(client), null, RANGE)
      expect(r.meta.dniRobocze).toBe(10)
      expect(r.dniRoboczeLacznie).toBe(30) // 10 working days × 3 active employees
      expect(r.wskaznik).toBe(0.2333) // 7 / 30
    })

    it('only counts APPROVED leave', async () => {
      await service.absencje(asClient(client), null, RANGE)
      const where = client.leaveRequest.findMany.mock.calls[0][0].where
      expect(where.status).toBe(LeaveStatus.APPROVED)
    })

    it('splits by leave type and DROPS a type whose whole leave fell on a weekend', async () => {
      const r = await service.absencje(asClient(client), null, RANGE)
      expect(r.wgTypu).toEqual([
        { typ: 'URLOP_WYPOCZYNKOWY', dni: 5, udzial: 0.7143 },
        { typ: 'CHOROBOWE', dni: 2, udzial: 0.2857 },
      ])
    })

    it('computes a per-unit rate against that unit’s own headcount', async () => {
      const r = await service.absencje(asClient(client), null, RANGE)
      expect(r.wgJednostek).toEqual([
        // unit-A: 2 active × 10 days = 20; 5 absence days → 0.25
        { unitId: 'unit-A', nazwa: 'Serwis', dni: 5, dniRobocze: 20, wskaznik: 0.25 },
        // unit-B: 1 active (e4 deactivated) × 10 = 10; 2 absence days → 0.2
        { unitId: 'unit-B', nazwa: 'Biuro', dni: 2, dniRobocze: 10, wskaznik: 0.2 },
      ])
    })

    it('reports an UNKNOWN (null) rate rather than 0 when nobody is in scope', async () => {
      client.employee.findMany.mockResolvedValue([])
      client.leaveRequest.findMany.mockResolvedValue([])
      const r = await service.absencje(asClient(client), null, RANGE)
      expect(r.wskaznik).toBeNull()
    })
  })

  // --- 3. Czas pracy ------------------------------------------------------------------------------

  describe('czasPracy', () => {
    it('sums hours from the roster with the shared overnight-window semantics', async () => {
      const r = await service.czasPracy(asClient(client), null, RANGE)
      // e1: 5×10h + 4×8h = 82h; e3: 2×10h = 20h.
      expect(r.sumaGodzin).toBe(102)
      expect(r.liczbaZmian).toBe(11)
    })

    it('averages hours over DISTINCT worked employee-days', async () => {
      const r = await service.czasPracy(asClient(client), null, RANGE)
      expect(r.osobodni).toBe(11)
      expect(r.sredniaDzienna).toBe(9.27) // 102 / 11
    })

    it('derives the weekly norm from etat × 8h × working days of that week in range', async () => {
      const r = await service.czasPracy(asClient(client), null, RANGE)
      // e1 week1 40 + e1 week2 40 + e3 week1 (0.5 × 8 × 5) 20 = 100h.
      expect(r.normaGodzin).toBe(100)
    })

    it('sums surplus and shortfall SEPARATELY, never netting one against the other', async () => {
      const r = await service.czasPracy(asClient(client), null, RANGE)
      // e1 week1 50h vs 40h norm = +10h; e1 week2 32h vs 40h = −8h; e3 exactly at norm.
      expect(r.nadwyzkaPonadNorme).toBe(10)
      expect(r.niedoborDoNormy).toBe(8)
    })

    it('does NOT call the weekly surplus "nadgodziny" — 12h x 3 days is 0 here but 12h under KP', async () => {
      // 3 x 12h = 36h <= the 40h weekly norm, so the WEEKLY measure sees nothing. Art. 151 par. 1 KP
      // counts 4h of DAILY overtime on each of those days. The field name and the caveat must both
      // say so rather than letting a reader take this for a payroll or compliance figure.
      client.shift.findMany.mockResolvedValue([
        shift('e1', '2026-06-01', '06:00', '18:00', 'unit-A', 1.0),
        shift('e1', '2026-06-02', '06:00', '18:00', 'unit-A', 1.0),
        shift('e1', '2026-06-03', '06:00', '18:00', 'unit-A', 1.0),
      ])
      const r = await service.czasPracy(asClient(client), null, RANGE)
      expect(r.sumaGodzin).toBe(36)
      expect(r.nadwyzkaPonadNorme).toBe(0)
      expect(r).not.toHaveProperty('nadgodziny')
      expect(r.meta.uwagi.join(' ')).toMatch(/art\. 151/)
    })

    it('does NOT charge a deficit for an employee-week with no shifts at all', async () => {
      // e2 worked nothing in the whole range; a 2-week 80h "deficit" would be an absence, not
      // under-worked time — so e2 must contribute nothing to norm or deficit.
      const r = await service.czasPracy(asClient(client), null, RANGE)
      expect(r.normaGodzin).toBe(100) // no e2 contribution
      expect(r.niedoborDoNormy).toBe(8) // e1's week 2 only
    })

    it('splits hours and surplus by unit', async () => {
      const r = await service.czasPracy(asClient(client), null, RANGE)
      expect(r.wgJednostek).toEqual([
        { unitId: 'unit-A', nazwa: 'Serwis', godziny: 82, nadwyzka: 10 },
        { unitId: 'unit-B', nazwa: 'Biuro', godziny: 20, nadwyzka: 0 },
      ])
    })

    it('ranks employees by surplus using IDs only (no PII in the payload)', async () => {
      const r = await service.czasPracy(asClient(client), null, RANGE)
      expect(r.topNadwyzka).toEqual([{ employeeId: 'e1', unitId: 'unit-A', nadwyzka: 10 }])
      expect(JSON.stringify(r)).not.toMatch(/firstName|lastName|pesel/i)
    })

    it('reports a null daily average (not 0) when nothing was worked', async () => {
      client.shift.findMany.mockResolvedValue([])
      const r = await service.czasPracy(asClient(client), null, RANGE)
      expect(r.sumaGodzin).toBe(0)
      expect(r.sredniaDzienna).toBeNull()
    })

    it('handles an overnight shift as a wrap past midnight', async () => {
      client.shift.findMany.mockResolvedValue([shift('e1', '2026-06-01', '22:00', '06:00', 'unit-A', 1.0)])
      const r = await service.czasPracy(asClient(client), null, RANGE)
      expect(r.sumaGodzin).toBe(8)
    })
  })

  // --- 4. Wykorzystanie urlopów -------------------------------------------------------------------

  describe('urlopy', () => {
    it('no longer classifies leave in SQL — the case-sensitive URLOP prefix filter is gone', async () => {
      await service.urlopy(asClient(client), null, RANGE)
      const where = client.leaveRequest.findMany.mock.calls[0][0].where
      expect(where.status).toBe(LeaveStatus.APPROVED)
      // A Prisma `startsWith: 'URLOP'` compiles to `LIKE 'URLOP%'` on Postgres — CASE-SENSITIVE, so
      // a lower-cased row silently vanished. Classification is now in memory and shared with
      // strategic-brain, so the same row can no longer mean two different things.
      expect(where.type).toBeUndefined()
    })

    it('computes used days per employee for the calendar year of "do"', async () => {
      const r = await service.urlopy(asClient(client), null, RANGE)
      expect(r.rok).toBe(2026)
      expect(r.wymiarDni).toBe(WYMIAR_URLOPU_DNI)
      expect(r.liczbaPracownikow).toBe(3)
      // e1 = 5 working days. e2's June leave is a weekend -> 0, but its LOWER-CASED February row
      // (02-02..02-04) is 3 working days and MUST count. e3's rows are sick / unpaid / maternity
      // leave: absences, but none of them consume the art. 154 pool.
      expect(r.wykorzystaneDni).toBe(8)
      expect(r.wskaznikWykorzystania).toBe(0.1026) // 8 / (26 x 3)
    })

    it('EXCLUDES leave that does not consume the art. 154 pool, however "URLOP" it looks', async () => {
      const r = await service.urlopy(asClient(client), null, RANGE)
      // e3 carries CHOROBOWE + URLOP_BEZPLATNY + URLOP_MACIERZYNSKI in the year — 15 working days
      // the old prefix filter would have charged against a 26-day entitlement, driving the balance
      // of anyone back from maternity leave deeply negative.
      expect(r.srednieSaldo).toBe(23.33) // (21 + 23 + 26) / 3, e3 untouched at 26
    })

    it('averages the remaining balance across employees in scope', async () => {
      const r = await service.urlopy(asClient(client), null, RANGE)
      // balances: e1 = 26-5 = 21, e2 = 26-3 = 23, e3 = 26-0 = 26 -> 70/3 = 23.33
      expect(r.srednieSaldo).toBe(23.33)
    })

    it('buckets the balance distribution', async () => {
      const r = await service.urlopy(asClient(client), null, RANGE)
      expect(r.rozkladSalda).toEqual([
        { przedzial: '0', liczba: 0 },
        { przedzial: '1-5', liczba: 0 },
        { przedzial: '6-10', liczba: 0 },
        { przedzial: '11-15', liczba: 0 },
        { przedzial: '16-20', liczba: 0 },
        { przedzial: '21+', liczba: 3 },
      ])
    })

    it('stays SILENT about forfeiture risk outside Q4 — a big June balance is normal', async () => {
      const r = await service.urlopy(asClient(client), null, RANGE)
      expect(r.ryzykoPrzepadniecia).toEqual([])
    })

    it('flags high balances in Q4, worst first, with IDs only', async () => {
      const q4 = buildRange('2026-11-01', '2026-11-30')
      const r = await service.urlopy(asClient(client), null, q4)
      // Same used-days data → balances 21 / 23 / 26, all ≥ the 10-day threshold.
      expect(r.ryzykoPrzepadniecia).toEqual([
        { employeeId: 'e3', unitId: 'unit-B', saldo: 26, wykorzystane: 0 },
        { employeeId: 'e2', unitId: 'unit-A', saldo: 23, wykorzystane: 3 },
        { employeeId: 'e1', unitId: 'unit-A', saldo: 21, wykorzystane: 5 },
      ])
    })
  })

  // --- 5. Wnioski ---------------------------------------------------------------------------------

  describe('wnioski', () => {
    it('counts requests filed in the range by outcome', async () => {
      const r = await service.wnioski(asClient(client), null, RANGE)
      expect(r.zlozone).toBe(4)
      expect(r.zaakceptowane).toBe(2)
      expect(r.odrzucone).toBe(1)
      expect(r.anulowane).toBe(0)
      expect(r.odsetekOdrzucen).toBe(0.3333) // 1 / (2 + 1)
    })

    it('counts the open backlog separately, including requests filed BEFORE the range', async () => {
      const r = await service.wnioski(asClient(client), null, RANGE)
      expect(r.wToku).toBe(3) // w3 + the older p2 + p3
    })

    it('takes the MEDIAN time to decision, so one slow outlier does not distort it', async () => {
      const r = await service.wnioski(asClient(client), null, RANGE)
      // decisions took 6h, 48h and 12h → median 12h (the mean would be 22h).
      expect(r.medianaGodzinDoDecyzji).toBe(12)
    })

    it('reports a null median (not 0) when nothing was decided', async () => {
      client.leaveRequest.findMany.mockResolvedValue([])
      const r = await service.wnioski(asClient(client), null, RANGE)
      expect(r.medianaGodzinDoDecyzji).toBeNull()
      expect(r.odsetekOdrzucen).toBeNull()
    })

    it('ranks approval bottlenecks by queue length, then by the oldest waiting request', async () => {
      const r = await service.wnioski(asClient(client), null, RANGE)
      expect(r.waskieGardla).toEqual([
        // unit-A holds w3 (3 days old at 06-14) and p2 (24 days old) → oldest 24.
        { unitId: 'unit-A', nazwa: 'Serwis', managerUserId: 'mgr-1', wToku: 2, najstarszyWiekDni: 24 },
        { unitId: 'unit-B', nazwa: 'Biuro', managerUserId: null, wToku: 1, najstarszyWiekDni: 1 },
      ])
    })

    it('measures backlog age against the END of the range, not wall-clock now', async () => {
      // Re-running the same fixture over a LATER range end must age the same request further.
      const later = buildRange('2026-06-01', '2026-06-21')
      const r = await service.wnioski(asClient(client), null, later)
      const unitA = r.waskieGardla.find((w) => w.unitId === 'unit-A')
      expect(unitA?.najstarszyWiekDni).toBe(31) // p2 filed 2026-05-20T09:00 → 31 days by 06-21
    })

    it('ranks deciders by their own median decision time, slowest first', async () => {
      const r = await service.wnioski(asClient(client), null, RANGE)
      expect(r.czasDecyzjiWgDecydenta).toEqual([
        { decydentUserId: 'mgr-1', liczbaDecyzji: 2, medianaGodzin: 27 }, // median(6, 48)
        { decydentUserId: 'mgr-2', liczbaDecyzji: 1, medianaGodzin: 12 },
      ])
    })

    it('splits filed requests by type, biggest first', async () => {
      const r = await service.wnioski(asClient(client), null, RANGE)
      expect(r.wgTypu).toEqual([
        { typ: 'URLOP_WYPOCZYNKOWY', liczba: 2 },
        { typ: 'CHOROBOWE', liczba: 1 },
        { typ: 'URLOP_NA_ZADANIE', liczba: 1 },
      ])
    })
  })

  // --- aggregate ------------------------------------------------------------------------------------

  describe('podsumowanie', () => {
    it('returns all five aggregates with figures identical to the individual endpoints', async () => {
      const r = await service.podsumowanie(asClient(client), null, RANGE)
      expect(r.zatrudnienie.stanNaKoniec).toBe(3)
      expect(r.absencje.wskaznik).toBe(0.2333)
      expect(r.czasPracy.sumaGodzin).toBe(102)
      expect(r.urlopy.wykorzystaneDni).toBe(8)
      expect(r.wnioski.wToku).toBe(3)
    })

    it('carries the honest caveats about how the figures were derived', async () => {
      const r = await service.podsumowanie(asClient(client), null, RANGE)
      expect(r.meta.uwagi.join(' ')).toMatch(/kalendarza świąt/)
      expect(r.czasPracy.meta.uwagi.join(' ')).toMatch(/z grafiku/)
      expect(r.urlopy.meta.uwagi.join(' ')).toMatch(/ryczałtowo/)
    })

    it('echoes the analysed range and scope back to the caller', async () => {
      const r = await service.podsumowanie(asClient(client), ['unit-A'], RANGE)
      expect(r.meta).toMatchObject({ od: '2026-06-01', do: '2026-06-14', unitIds: ['unit-A'], dniRobocze: 10 })
    })
  })

  describe('porownanie', () => {
    it('compares against the immediately preceding window of EQUAL length', async () => {
      const r = await service.porownanie(asClient(client), null, RANGE)
      expect(r.biezacy).toMatchObject({ od: '2026-06-01', do: '2026-06-14' })
      // 14 days long → the previous window is 2026-05-18 .. 2026-05-31.
      expect(r.poprzedni).toMatchObject({ od: '2026-05-18', do: '2026-05-31' })
    })

    it('reports the delta for each headline KPI', async () => {
      const r = await service.porownanie(asClient(client), null, RANGE)
      // The mock returns the same rows for both windows, so every delta is 0 — what matters is
      // that a delta is COMPUTED per KPI rather than omitted.
      expect(r.zmiana.stanZatrudnienia).toBe(0)
      expect(r.zmiana.sumaGodzin).toBe(0)
      expect(typeof r.zmiana.wnioskiWToku).toBe('number')
    })

    it('detects an absence spike end-to-end, from Prisma rows through clipping to the rule', async () => {
      const r = await service.anomalie(asClient(client), null, RANGE)

      expect(r.biezacy).toMatchObject({ od: '2026-06-01', do: '2026-06-14' })
      expect(r.poprzedni).toMatchObject({ od: '2026-05-18', do: '2026-05-31' })

      // The SAME leave rows clip very differently into the two windows, which is the whole point:
      //   current  (06-01..06-14): L1 = 5 working days + L2 clipped to 06-01,06-02 = 2 → 7/30 = 23,33%
      //   previous (05-18..05-31): only L2 clipped to Thu 05-28 + Fri 05-29 = 2      → 2/30 =  6,67%
      expect(r.biezacy.wskaznikAbsencji).toBe(0.2333)
      expect(r.poprzedni.wskaznikAbsencji).toBe(0.0667)

      const absencja = r.anomalie.find((a) => a.kod === 'ABSENCJA_SKOK')
      expect(absencja).toBeDefined()
      expect(absencja?.waga).toBe('wysoka') // +16,7 p.p. is far past the 3 p.p. high bar
      expect(absencja?.wartoscBiezaca).toBe(0.2333)
      expect(absencja?.wartoscPoprzednia).toBe(0.0667)
    })

    it('raises no OTHER anomaly when only absence moved', async () => {
      const r = await service.anomalie(asClient(client), null, RANGE)
      // Headcount, hours and the request backlog are identical across both windows in this fixture.
      expect(r.anomalie.map((a) => a.kod)).toEqual(['ABSENCJA_SKOK'])
    })

    it('refuses to invent a delta when either side is unknown', async () => {
      client.employee.findMany.mockResolvedValue([])
      const r = await service.porownanie(asClient(client), null, RANGE)
      // No employees → absence rate is null on BOTH sides → the delta must stay null, not 0.
      expect(r.biezacy.wskaznikAbsencji).toBeNull()
      expect(r.zmiana.wskaznikAbsencji).toBeNull()
    })
  })
})
