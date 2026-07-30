import { BadRequestException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { VoiceCommandService, type VoiceActor } from './voice-command.service.js'
import { LeaveService } from '../leave/leave.service.js'
import { GrafikService } from '../grafik/grafik.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'

const TODAY = new Date('2026-07-29T00:00:00.000Z') // Wednesday

const leave = { createRequest: jest.fn() }
const grafik = { listShifts: jest.fn() }
const audit = { log: jest.fn() }

const client = {} as unknown as TenantClient
const actor: VoiceActor = { userId: 'kc-emp-1', roles: ['PRACOWNIK'], ipAddress: '1.2.3.4' }

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

    it('NIEZNANE never executes — returns a fallback-to-form result', async () => {
      const res = await svc.execute(client, actor, { intent: 'NIEZNANE', entities: {}, confirm: true }, TODAY)
      expect(res.executed).toBe(false)
      expect(res.fallbackToForm).toBe(true)
      expect(leave.createRequest).not.toHaveBeenCalled()
      expect(grafik.listShifts).not.toHaveBeenCalled()
    })
  })
})
