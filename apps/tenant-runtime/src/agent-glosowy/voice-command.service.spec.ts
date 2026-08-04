import { BadRequestException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { VoiceCommandService, type VoiceActor } from './voice-command.service.js'
import { LeaveService } from '../leave/leave.service.js'
import { GrafikService } from '../grafik/grafik.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { INTENT_CATALOG } from './intent.util.js'

const TODAY = new Date('2026-07-29T00:00:00.000Z') // Wednesday

const leave = { createRequest: jest.fn(), list: jest.fn() }
const grafik = { listShifts: jest.fn() }
const audit = { log: jest.fn() }

// Real client methods KTO_PRACUJE reads directly (own-identity + roster lookups), mirroring how
// GrafikService/LeaveService/EmployeesService resolve "who am I" / unit scope inline. Everything
// else on TenantClient is untouched by VoiceCommandService.
const prismaClient = {
  employee: { findFirst: jest.fn(), findMany: jest.fn() },
  userRole: { findMany: jest.fn() },
}
const client = prismaClient as unknown as TenantClient
const actor: VoiceActor = { userId: 'kc-emp-1', roles: ['PRACOWNIK'], ipAddress: '1.2.3.4' }
const managerActor: VoiceActor = { userId: 'kc-mgr-1', roles: ['MANAGER'], ipAddress: '1.2.3.4' }

function makeService(): VoiceCommandService {
  return new VoiceCommandService(
    leave as unknown as LeaveService,
    grafik as unknown as GrafikService,
    audit as unknown as AuditService,
  )
}

describe('VoiceCommandService', () => {
  let svc: VoiceCommandService
  beforeEach(() => {
    svc = makeService()
    jest.clearAllMocks()
    prismaClient.userRole.findMany.mockResolvedValue([])
    prismaClient.employee.findFirst.mockResolvedValue(null)
    prismaClient.employee.findMany.mockResolvedValue([])
  })

  describe('interpret — describes, NEVER executes', () => {
    it('URLOP (write) requires confirmation and proposes a CREATE_LEAVE action', () => {
      const r = svc.interpret('chcę urlop od 1 do 5 sierpnia', TODAY, actor)
      expect(r.intent).toBe('URLOP')
      expect(r.requiresConfirmation).toBe(true)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('CREATE_LEAVE')
      // interpret must not touch any real service
      expect(leave.createRequest).not.toHaveBeenCalled()
    })

    it('MOJ_GRAFIK (read) does NOT require confirmation', () => {
      const r = svc.interpret('jaki mam grafik jutro', TODAY, actor)
      expect(r.intent).toBe('MOJ_GRAFIK')
      expect(r.requiresConfirmation).toBe(false)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('READ_SCHEDULE')
    })

    it('an out-of-set utterance falls back to a manual form', () => {
      const r = svc.interpret('jaka jest pogoda', TODAY, actor)
      expect(r.intent).toBe('NIEZNANE')
      expect(r.fallbackToForm).toBe(true)
      expect(r.requiresConfirmation).toBe(false)
    })

    it('a low-confidence write (no parseable date) falls back to a manual form', () => {
      const r = svc.interpret('chcę wziąć urlop', TODAY, actor)
      expect(r.fallbackToForm).toBe(true)
      expect(r.requiresConfirmation).toBe(false)
    })

    it('SALDO_URLOPU (read) does NOT require confirmation', () => {
      const r = svc.interpret('ile mam dni urlopu', TODAY, actor)
      expect(r.intent).toBe('SALDO_URLOPU')
      expect(r.requiresConfirmation).toBe(false)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('READ_LEAVE_BALANCE')
    })

    it('STATUS_WNIOSKU (read) does NOT require confirmation', () => {
      const r = svc.interpret('co z moim wnioskiem', TODAY, actor)
      expect(r.intent).toBe('STATUS_WNIOSKU')
      expect(r.requiresConfirmation).toBe(false)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('READ_LEAVE_STATUS')
    })

    it('POMOC (read) is SELF-UPDATING from INTENT_CATALOG — never a hand-copied string', () => {
      const r = svc.interpret('pomoc', TODAY, actor)
      expect(r.intent).toBe('POMOC')
      expect(r.requiresConfirmation).toBe(false)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('READ_HELP')
      // every catalog entry (bar POMOC itself) must appear — this reads INTENT_CATALOG at TEST-RUN
      // TIME, so a future intent added to the catalog is asserted here automatically, with no edit
      // to this test required; a hand-copied help string would drift and fail this loop.
      const rest = INTENT_CATALOG.filter((e) => e.intent !== 'POMOC')
      for (const entry of rest) {
        expect(r.humanReadable).toContain(entry.opis)
      }
      // exact count: catches both a stray hardcoded extra line AND a silently dropped entry.
      const lines = r.humanReadable.split('\n').filter((l) => l.startsWith('- '))
      expect(lines.length).toBe(rest.length)
    })

    it('KTO_PRACUJE (read) does NOT require confirmation', () => {
      const r = svc.interpret('kto dzisiaj pracuje', TODAY, actor)
      expect(r.intent).toBe('KTO_PRACUJE')
      expect(r.requiresConfirmation).toBe(false)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('READ_WHO_WORKS')
    })

    it('NASTEPNA_ZMIANA (read) does NOT require confirmation', () => {
      const r = svc.interpret('kiedy mam następną zmianę', TODAY, actor)
      expect(r.intent).toBe('NASTEPNA_ZMIANA')
      expect(r.requiresConfirmation).toBe(false)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('READ_NEXT_SHIFT')
    })

    it('MOJA_EWIDENCJA (read) does NOT require confirmation', () => {
      const r = svc.interpret('ile przepracowałem godzin w tym tygodniu', TODAY, actor)
      expect(r.intent).toBe('MOJA_EWIDENCJA')
      expect(r.requiresConfirmation).toBe(false)
      expect(r.fallbackToForm).toBe(false)
      expect(r.proposedAction.kind).toBe('READ_TIMESHEET')
    })

    it('carries an EU AI Act transparency notice on every interpretation', () => {
      const r = svc.interpret('jaki mam grafik jutro', TODAY, actor)
      expect(r.aiNotice).toMatch(/AI/)
    })
  })

  describe('execute — human-in-the-loop write gate (EU AI Act / art. 22 RODO)', () => {
    it('REFUSES a write intent when confirm !== true and NEVER calls the real leave service', async () => {
      await expect(
        svc.execute(client, actor, { intent: 'URLOP', entities: { dateFrom: '2026-08-01', dateTo: '2026-08-05', type: 'URLOP_WYPOCZYNKOWY' }, confirm: false }, TODAY),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(leave.createRequest).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('creates a leave request via the REAL LeaveService when confirmed, acting AS the actor', async () => {
      leave.createRequest.mockResolvedValue({ id: 'lr-1', employeeId: 'emp-1' })
      const res = await svc.execute(
        client,
        actor,
        { intent: 'URLOP', entities: { dateFrom: '2026-08-01', dateTo: '2026-08-05', type: 'URLOP_WYPOCZYNKOWY' }, confirm: true },
        TODAY,
      )
      // reuses the real service, passing the SAME actor (no privilege escalation)
      expect(leave.createRequest).toHaveBeenCalledWith(client, actor, {
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        type: 'URLOP_WYPOCZYNKOWY',
      })
      expect(res.executed).toBe(true)
      expect(res.confirmedByHuman).toBe(true)
      expect(res.result).toEqual({ id: 'lr-1', employeeId: 'emp-1' })
    })

    it('maps L4 to type ZWOLNIENIE_LEKARSKIE and writes an IDS-ONLY audit entry', async () => {
      leave.createRequest.mockResolvedValue({ id: 'lr-2', employeeId: 'emp-2' })
      await svc.execute(
        client,
        actor,
        { intent: 'L4', entities: { dateFrom: '2026-07-30', dateTo: '2026-07-30' }, confirm: true },
        TODAY,
      )
      expect(leave.createRequest).toHaveBeenCalledWith(client, actor, {
        startDate: '2026-07-30',
        endDate: '2026-07-30',
        type: 'ZWOLNIENIE_LEKARSKIE',
      })
      expect(audit.log).toHaveBeenCalledTimes(1)
      const logged = audit.log.mock.calls[0][0]
      expect(logged.action).toBe('agent-glosowy.execute')
      expect(logged.actorUserId).toBe('kc-emp-1')
      // ids-only payload: intent + ids, no PII (name/PESEL/etc.)
      expect(logged.payload).toEqual({ intent: 'L4', leaveRequestId: 'lr-2', employeeId: 'emp-2' })
    })

    it('reads the schedule via the REAL GrafikService (no confirm needed), filtered to the date', async () => {
      grafik.listShifts.mockResolvedValue([
        { id: 's1', date: new Date('2026-07-30T00:00:00.000Z') },
        { id: 's2', date: new Date('2026-08-01T00:00:00.000Z') },
      ])
      const res = await svc.execute(
        client,
        actor,
        { intent: 'MOJ_GRAFIK', entities: { dateFrom: '2026-07-30', dateTo: '2026-07-30' }, confirm: false },
        TODAY,
      )
      expect(grafik.listShifts).toHaveBeenCalledWith(client, actor)
      expect(res.executed).toBe(true)
      expect(res.result).toEqual([{ id: 's1', date: new Date('2026-07-30T00:00:00.000Z') }])
      // a read must never fall through to a write
      expect(leave.createRequest).not.toHaveBeenCalled()
      expect(audit.log).toHaveBeenCalledTimes(1)
    })

    it('computes the leave balance via the REAL LeaveService (mine + APPROVED), no confirm needed', async () => {
      leave.list.mockResolvedValue([
        { employeeId: 'emp-1', startDate: new Date('2026-01-05T00:00:00.000Z'), endDate: new Date('2026-01-09T00:00:00.000Z'), type: 'URLOP_WYPOCZYNKOWY', status: 'APPROVED' },
      ])
      const res = await svc.execute(client, actor, { intent: 'SALDO_URLOPU', entities: {}, confirm: false }, TODAY)
      expect(leave.list).toHaveBeenCalledWith(client, actor, { mine: true, state: 'APPROVED' })
      expect(res.executed).toBe(true)
      expect(res.result).toEqual({ wymiarDni: 20, wykorzystaneDni: 5, pozostaleDni: 15 })
      expect(leave.createRequest).not.toHaveBeenCalled()
      expect(audit.log).toHaveBeenCalledTimes(1)
    })

    it('returns the most recent own leave request via the REAL LeaveService (mine), no confirm needed', async () => {
      leave.list.mockResolvedValue([
        { id: 'lr-9', status: 'PENDING', type: 'URLOP_WYPOCZYNKOWY', startDate: new Date('2026-08-10T00:00:00.000Z'), endDate: new Date('2026-08-12T00:00:00.000Z'), createdAt: new Date('2026-07-20T00:00:00.000Z') },
      ])
      const res = await svc.execute(client, actor, { intent: 'STATUS_WNIOSKU', entities: {}, confirm: false }, TODAY)
      expect(leave.list).toHaveBeenCalledWith(client, actor, { mine: true })
      expect(res.executed).toBe(true)
      expect(res.result).toEqual({ id: 'lr-9', status: 'PENDING', type: 'URLOP_WYPOCZYNKOWY', startDate: '2026-08-10', endDate: '2026-08-12' })
      expect(audit.log).toHaveBeenCalledTimes(1)
    })

    it('reports no requests when the caller has filed none', async () => {
      leave.list.mockResolvedValue([])
      const res = await svc.execute(client, actor, { intent: 'STATUS_WNIOSKU', entities: {}, confirm: false }, TODAY)
      expect(res.executed).toBe(true)
      expect(res.result).toBeNull()
      expect(res.humanReadable).toMatch(/nie złożyłeś|brak wniosk/i)
    })

    it('runs POMOC directly (read, no confirm) and audits it', async () => {
      const res = await svc.execute(client, actor, { intent: 'POMOC', entities: {}, confirm: false }, TODAY)
      expect(res.executed).toBe(true)
      expect(res.fallbackToForm).toBe(false)
      expect(res.humanReadable).toContain(INTENT_CATALOG.find((e) => e.intent === 'URLOP')!.opis)
      expect(audit.log).toHaveBeenCalledTimes(1)
    })

    describe('KTO_PRACUJE — scoped roster read', () => {
      it('MANAGER sees the roster of their managed unit(s), split into working/absent', async () => {
        prismaClient.userRole.findMany.mockResolvedValue([{ unitId: 'unit-1' }])
        prismaClient.employee.findMany.mockResolvedValue([
          { id: 'emp-A', firstName: 'Anna', lastName: 'Nowak' },
          { id: 'emp-B', firstName: 'Bartek', lastName: 'Kowal' },
        ])
        grafik.listShifts.mockResolvedValue([
          { employeeId: 'emp-A', date: new Date('2026-07-29T00:00:00.000Z') },
        ])
        leave.list.mockResolvedValue([
          { employeeId: 'emp-B', startDate: new Date('2026-07-28T00:00:00.000Z'), endDate: new Date('2026-07-30T00:00:00.000Z') },
        ])

        const res = await svc.execute(client, managerActor, { intent: 'KTO_PRACUJE', entities: { dateFrom: '2026-07-29' }, confirm: false }, TODAY)

        expect(leave.list).toHaveBeenCalledWith(client, managerActor, { state: 'APPROVED' })
        expect(res.executed).toBe(true)
        expect(res.result).toEqual({ date: '2026-07-29', pracujacy: ['Anna Nowak'], nieobecni: ['Bartek Kowal'] })
        expect(audit.log).toHaveBeenCalledTimes(1)
      })

      it('[SZCZELNOŚĆ] a plain PRACOWNIK never triggers a roster query and never sees another employee — even if the underlying mocks hand back foreign data', async () => {
        // actor has NO managed units (userRole.findMany → []); this is what makes them "plain".
        prismaClient.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
        // Simulate a hypothetically-buggy GrafikService/LeaveService handing back OTHER people's
        // rows too — VoiceCommandService itself must still never surface them for a plain employee.
        grafik.listShifts.mockResolvedValue([
          { employeeId: 'emp-self', date: new Date('2026-07-29T00:00:00.000Z') },
          { employeeId: 'emp-OTHER', date: new Date('2026-07-29T00:00:00.000Z') },
        ])
        leave.list.mockResolvedValue([])

        const res = await svc.execute(client, actor, { intent: 'KTO_PRACUJE', entities: { dateFrom: '2026-07-29' }, confirm: false }, TODAY)

        // no unit-wide roster lookup at all for a plain employee
        expect(prismaClient.employee.findMany).not.toHaveBeenCalled()
        expect(leave.list).toHaveBeenCalledWith(client, actor, { mine: true, state: 'APPROVED' })
        expect(res.result).toEqual({ date: '2026-07-29', self: { working: true, onApprovedLeave: false } })
        expect(JSON.stringify(res.result)).not.toMatch(/emp-OTHER/)
        expect(JSON.stringify(res.humanReadable)).not.toMatch(/emp-OTHER/)
      })
    })

    describe('NASTEPNA_ZMIANA — earliest upcoming own shift', () => {
      it('picks the earliest FUTURE shift (skipping a past one and picking over a later one), scoped to own employeeId', async () => {
        prismaClient.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
        grafik.listShifts.mockResolvedValue([
          { id: 's-past', employeeId: 'emp-self', date: new Date('2026-07-28T00:00:00.000Z'), start: '08:00', end: '16:00' },
          { id: 's-later', employeeId: 'emp-self', date: new Date('2026-08-02T00:00:00.000Z'), start: '08:00', end: '16:00' },
          { id: 's-next', employeeId: 'emp-self', date: new Date('2026-07-30T00:00:00.000Z'), start: '08:00', end: '16:00' },
          { id: 's-other', employeeId: 'emp-OTHER', date: new Date('2026-07-29T00:00:00.000Z'), start: '08:00', end: '16:00' },
        ])

        const res = await svc.execute(client, actor, { intent: 'NASTEPNA_ZMIANA', entities: {}, confirm: false }, TODAY)

        expect(grafik.listShifts).toHaveBeenCalledWith(client, actor)
        expect(res.executed).toBe(true)
        expect((res.result as { id: string }).id).toBe('s-next')
        expect(res.humanReadable).toMatch(/2026-07-30/)
      })

      it('a dateless "no upcoming shifts" answers in Polish — never an empty result or a thrown exception', async () => {
        prismaClient.employee.findFirst.mockResolvedValue({ id: 'emp-self' })
        grafik.listShifts.mockResolvedValue([])

        const res = await svc.execute(client, actor, { intent: 'NASTEPNA_ZMIANA', entities: {}, confirm: false }, TODAY)

        expect(res.executed).toBe(true)
        expect(res.result).toBeNull()
        expect(res.humanReadable).toMatch(/nie masz.{0,40}zmian/i)
      })
    })

    describe('MOJA_EWIDENCJA — worked hours vs weekly norm, own shifts only', () => {
      const PERIOD = { dateFrom: '2026-07-27', dateTo: '2026-08-02' } // Mon..Sun, 5 business days

      it('sums own shift hours in the period against the weekly norm, and never labels the excess "nadgodziny"', async () => {
        prismaClient.employee.findFirst.mockResolvedValue({ id: 'emp-self', etat: 1 })
        grafik.listShifts.mockResolvedValue([
          { employeeId: 'emp-self', date: new Date('2026-07-27T00:00:00.000Z'), start: '08:00', end: '16:00' }, // 8h, Mon
          { employeeId: 'emp-self', date: new Date('2026-07-28T00:00:00.000Z'), start: '08:00', end: '16:00' }, // 8h, Tue
          { employeeId: 'emp-self', date: new Date('2026-07-29T00:00:00.000Z'), start: '08:00', end: '16:00' }, // 8h, Wed
          { employeeId: 'emp-self', date: new Date('2026-07-30T00:00:00.000Z'), start: '08:00', end: '16:00' }, // 8h, Thu
          { employeeId: 'emp-self', date: new Date('2026-07-31T00:00:00.000Z'), start: '08:00', end: '16:00' }, // 8h, Fri
          { employeeId: 'emp-self', date: new Date('2026-08-01T00:00:00.000Z'), start: '08:00', end: '16:00' }, // 8h, Sat (outside 5 biz days)
          { employeeId: 'emp-OTHER', date: new Date('2026-07-27T00:00:00.000Z'), start: '08:00', end: '16:00' }, // must be excluded (not mine)
          { employeeId: 'emp-self', date: new Date('2026-08-10T00:00:00.000Z'), start: '08:00', end: '16:00' }, // must be excluded (outside period)
        ])

        const res = await svc.execute(client, actor, { intent: 'MOJA_EWIDENCJA', entities: PERIOD, confirm: false }, TODAY)

        expect(grafik.listShifts).toHaveBeenCalledWith(client, actor)
        const result = res.result as { sumaGodzin: number; normaGodzin: number; nadwyzkaPonadNorme: number; niedoborDoNormy: number }
        expect(result.sumaGodzin).toBe(48)
        expect(result.normaGodzin).toBe(40) // etat 1 × 8h × 5 business days
        expect(result.nadwyzkaPonadNorme).toBe(8)
        expect(result.niedoborDoNormy).toBe(0)
        // naming discipline: must not brand the excess "nadgodziny" (KP overtime) — see analityk's
        // identical disclaimer for `nadwyzkaPonadNorme`.
        expect(res.humanReadable).not.toMatch(/twoje nadgodziny/i)
        expect(res.humanReadable).toMatch(/nadwyżk[ae]/i)
        expect(res.humanReadable).toMatch(/nie są nadgodzin/i)
      })
    })

    it('NIEZNANE never executes — returns a fallback-to-form result', async () => {
      const res = await svc.execute(client, actor, { intent: 'NIEZNANE', entities: {}, confirm: true }, TODAY)
      expect(res.executed).toBe(false)
      expect(res.fallbackToForm).toBe(true)
      expect(leave.createRequest).not.toHaveBeenCalled()
      expect(grafik.listShifts).not.toHaveBeenCalled()
    })
  })
})
