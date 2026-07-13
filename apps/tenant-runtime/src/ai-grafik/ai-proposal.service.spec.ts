import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { AiProposalState, AutonomyLevel, ConsentState, Role } from '@hrobot/shared'
import { AiProposalService } from './ai-proposal.service.js'
import type { AiConfigActor } from './ai-config.service.js'
import type { ReplacementService, RankedCandidate } from './replacement.service.js'
import type { AiConfigService } from './ai-config.service.js'
import type { AuditService } from '../tenant-runtime/audit/audit.service.js'
import type { SwapFeasibilityValidator } from '../shift-swap/swap-feasibility-validator.js'

const HR: AiConfigActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.1' }
const MANAGER: AiConfigActor = { userId: 'kc-mgr', roles: [Role.MANAGER], ipAddress: '10.0.0.2' }
const EMPLOYEE: AiConfigActor = { userId: 'kc-emp', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.3' }

const SHIFT_ID = 'shift-1'
const UNIT = 'unit-A'
const VACATED = 'emp-vacated'

type CreatedCandidate = {
  id: string
  employeeId: string
  rank: number
  feasible: boolean
  reason?: string
  score?: number
  consentState: string
  consentRequestedAt?: Date
}

/** Transaction handle the commit runs against (Task 1.4) — mirrors shift-swap.service.spec's MockTx. */
type MockTx = {
  shift: { updateMany: jest.Mock }
  aiProposal: { updateMany: jest.Mock }
  aiProposalCandidate: { update: jest.Mock }
  auditLog: { create: jest.Mock }
}

function makeClient() {
  const tx: MockTx = {
    shift: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    aiProposal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    aiProposalCandidate: { update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
  }
  return {
    shift: { findUnique: jest.fn().mockResolvedValue({ id: SHIFT_ID, employeeId: VACATED, employee: { unitId: UNIT } }) },
    employee: { findUnique: jest.fn(), findFirst: jest.fn() },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    aiProposalCandidate: { update: jest.fn().mockResolvedValue({}) },
    aiProposal: {
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'prop-1',
        state: data.state,
        shiftId: data.shiftId,
        vacatedEmployeeId: data.vacatedEmployeeId,
        reason: data.reason ?? null,
        activeCandidateId: data.activeCandidateId ?? null,
        expiresAt: data.expiresAt ?? null,
        candidates: data.candidates.create as CreatedCandidate[],
      })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'prop-1', candidates: [] }),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'prop-1', ...data })),
    },
    $transaction: jest.fn(async (cb: (tx: MockTx) => unknown) => cb(tx)),
    __tx: tx,
  }
}
type MockClient = ReturnType<typeof makeClient>
const as = (c: MockClient): TenantClient => c as unknown as TenantClient

function makeService(overrides: {
  ranked?: RankedCandidate[]
  autonomyLevel?: AutonomyLevel
  consentTtlHours?: number
  feasible?: boolean
  feasibleReason?: string
} = {}) {
  const replacement = {
    rankCandidatesForShift: jest.fn().mockResolvedValue(overrides.ranked ?? []),
  } as unknown as ReplacementService
  const aiConfig = {
    getConfig: jest.fn().mockResolvedValue({
      autonomyLevel: overrides.autonomyLevel ?? AutonomyLevel.SUGGEST_ONLY,
      consentTtlHours: overrides.consentTtlHours ?? 24,
    }),
  } as unknown as AiConfigService
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService
  const validate = jest.fn().mockResolvedValue({
    feasible: overrides.feasible ?? true,
    ...(overrides.feasibleReason != null ? { reason: overrides.feasibleReason } : {}),
  })
  const validator = { validate } as unknown as SwapFeasibilityValidator
  const service = new AiProposalService(replacement, aiConfig, audit, validator)
  return { service, replacement, aiConfig, audit, validator, validate }
}

const feasible = (id: string, rank: number, score = 0): RankedCandidate => ({ employeeId: id, feasible: true, rank, score })
const infeasible = (id: string, reason = 'H1'): RankedCandidate => ({ employeeId: id, feasible: false, rank: 0, reason })

describe('AiProposalService.createReplacement', () => {
  it('escalates when there is NO feasible candidate and audits ai_proposal.escalated', async () => {
    const client = makeClient()
    const { service, audit } = makeService({ ranked: [infeasible('a'), infeasible('b')] })

    const result = await service.createReplacement(as(client), HR, SHIFT_ID, 'urlop')

    expect(result.state).toBe(AiProposalState.ESCALATED)
    const data = client.aiProposal.create.mock.calls[0][0].data
    expect(data.state).toBe(AiProposalState.ESCALATED)
    expect(data.activeCandidateId).toBeUndefined()
    // Both infeasible candidates are still persisted.
    expect(data.candidates.create).toHaveLength(2)
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai_proposal.escalated',
        payload: expect.objectContaining({ reason: 'NO_FEASIBLE_CANDIDATE' }),
      }),
    )
  })

  it('creates a DRAFT proposal under SUGGEST_ONLY (no consent request)', async () => {
    const client = makeClient()
    const { service, audit } = makeService({ ranked: [feasible('c1', 1)], autonomyLevel: AutonomyLevel.SUGGEST_ONLY })

    const result = await service.createReplacement(as(client), HR, SHIFT_ID)

    expect(result.state).toBe(AiProposalState.DRAFT)
    const data = client.aiProposal.create.mock.calls[0][0].data
    expect(data.activeCandidateId).toBeUndefined()
    expect(data.expiresAt).toBeUndefined()
    expect(client.employee.findUnique).not.toHaveBeenCalled() // no reachability probe on the DRAFT path
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_proposal.created' }))
  })

  it('creates a DRAFT proposal under AUTO_NOTIFY', async () => {
    const client = makeClient()
    const { service } = makeService({ ranked: [feasible('c1', 1)], autonomyLevel: AutonomyLevel.AUTO_NOTIFY })

    const result = await service.createReplacement(as(client), HR, SHIFT_ID)

    expect(result.state).toBe(AiProposalState.DRAFT)
  })

  it('AUTO_ASK_CONSENT + reachable top → PENDING_EMPLOYEE_CONSENT, active candidate PENDING, expiresAt set', async () => {
    const client = makeClient()
    client.employee.findUnique.mockResolvedValue({ userId: 'kc-c1' }) // top candidate has a login
    const { service, audit } = makeService({
      ranked: [feasible('c1', 1), feasible('c2', 2)],
      autonomyLevel: AutonomyLevel.AUTO_ASK_CONSENT,
      consentTtlHours: 12,
    })
    const before = Date.now()

    const result = await service.createReplacement(as(client), HR, SHIFT_ID, 'choroba')

    expect(result.state).toBe(AiProposalState.PENDING_EMPLOYEE_CONSENT)
    const data = client.aiProposal.create.mock.calls[0][0].data
    expect(data.activeCandidateId).toBeDefined()
    expect(data.expiresAt).toBeInstanceOf(Date)
    // ~12h in the future.
    const ttlMs = (data.expiresAt as Date).getTime() - before
    expect(ttlMs).toBeGreaterThanOrEqual(12 * 60 * 60 * 1000 - 5000)
    expect(ttlMs).toBeLessThanOrEqual(12 * 60 * 60 * 1000 + 5000)

    const rows = data.candidates.create as CreatedCandidate[]
    const active = rows.find((r) => r.id === data.activeCandidateId)!
    expect(active.employeeId).toBe('c1') // the rank-1 feasible candidate
    expect(active.consentState).toBe(ConsentState.PENDING)
    expect(active.consentRequestedAt).toBeInstanceOf(Date)
    // The non-active candidate stays NOT_ASKED.
    expect(rows.find((r) => r.employeeId === 'c2')!.consentState).toBe(ConsentState.NOT_ASKED)
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_proposal.created' }))
  })

  it('AUTO_ASK_CONSENT + top has NO login → ESCALATED (EMPLOYEE_UNREACHABLE)', async () => {
    const client = makeClient()
    client.employee.findUnique.mockResolvedValue({ userId: null }) // unreachable
    const { service, audit } = makeService({
      ranked: [feasible('c1', 1)],
      autonomyLevel: AutonomyLevel.AUTO_ASK_CONSENT,
    })

    const result = await service.createReplacement(as(client), HR, SHIFT_ID)

    expect(result.state).toBe(AiProposalState.ESCALATED)
    const data = client.aiProposal.create.mock.calls[0][0].data
    expect(data.activeCandidateId).toBeUndefined()
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai_proposal.escalated',
        payload: expect.objectContaining({ reason: 'EMPLOYEE_UNREACHABLE' }),
      }),
    )
  })

  it('forbids a MANAGER who does not manage the shift unit', async () => {
    const client = makeClient()
    client.userRole.findMany.mockResolvedValue([{ unitId: 'other-unit' }])
    const { service } = makeService({ ranked: [feasible('c1', 1)] })

    await expect(service.createReplacement(as(client), MANAGER, SHIFT_ID)).rejects.toThrow(ForbiddenException)
    expect(client.aiProposal.create).not.toHaveBeenCalled()
  })

  it('lets a MANAGER who manages the shift unit create the proposal', async () => {
    const client = makeClient()
    client.userRole.findMany.mockResolvedValue([{ unitId: UNIT }])
    const { service } = makeService({ ranked: [feasible('c1', 1)], autonomyLevel: AutonomyLevel.SUGGEST_ONLY })

    const result = await service.createReplacement(as(client), MANAGER, SHIFT_ID)

    expect(result.state).toBe(AiProposalState.DRAFT)
  })

  it('404s when the shift does not exist', async () => {
    const client = makeClient()
    client.shift.findUnique.mockResolvedValue(null)
    const { service } = makeService()

    await expect(service.createReplacement(as(client), HR, SHIFT_ID)).rejects.toThrow(NotFoundException)
  })

  it('never writes PESEL/home (PII) into the audit payload — ids only', async () => {
    const client = makeClient()
    const { service, audit } = makeService({ ranked: [infeasible('a')] })

    await service.createReplacement(as(client), HR, SHIFT_ID, 'urlop')

    const payload = (audit.log as jest.Mock).mock.calls[0][0].payload
    expect(JSON.stringify(payload)).not.toMatch(/pesel|home|address|adres/i)
    expect(payload).toEqual(
      expect.objectContaining({ shiftId: SHIFT_ID, vacatedEmployeeId: VACATED }),
    )
  })
})

describe('AiProposalService.list', () => {
  it('a global HR sees every proposal (no unit filter)', async () => {
    const client = makeClient()
    const { service } = makeService()

    await service.list(as(client), HR, {})

    expect(client.aiProposal.findMany).toHaveBeenCalledWith({ where: {}, include: { candidates: true } })
  })

  it('a MANAGER is scoped to their managed units, optionally narrowed by state', async () => {
    const client = makeClient()
    client.userRole.findMany.mockResolvedValue([{ unitId: UNIT }])
    const { service } = makeService()

    await service.list(as(client), MANAGER, { state: AiProposalState.DRAFT })

    expect(client.aiProposal.findMany).toHaveBeenCalledWith({
      where: { shift: { employee: { unitId: { in: [UNIT] } } }, state: AiProposalState.DRAFT },
      include: { candidates: true },
    })
  })

  it('an employee with mine=true sees ONLY the proposal where they are the active PENDING candidate', async () => {
    const client = makeClient()
    client.employee.findFirst.mockResolvedValue({ id: 'emp-me' })
    const mine = {
      id: 'prop-mine',
      state: AiProposalState.PENDING_EMPLOYEE_CONSENT,
      activeCandidateId: 'cand-1',
      candidates: [{ id: 'cand-1', employeeId: 'emp-me', consentState: ConsentState.PENDING }],
    }
    const notMine = {
      id: 'prop-other',
      state: AiProposalState.PENDING_EMPLOYEE_CONSENT,
      activeCandidateId: 'cand-x',
      // emp-me appears but is NOT the active candidate.
      candidates: [
        { id: 'cand-x', employeeId: 'someone-else', consentState: ConsentState.PENDING },
        { id: 'cand-y', employeeId: 'emp-me', consentState: ConsentState.PENDING },
      ],
    }
    client.aiProposal.findMany.mockResolvedValue([mine, notMine])
    const { service } = makeService()

    const result = await service.list(as(client), EMPLOYEE, { mine: true })

    expect(result.map((p) => p.id)).toEqual(['prop-mine'])
  })

  it('an employee without mine=true sees nothing', async () => {
    const client = makeClient()
    const { service } = makeService()

    const result = await service.list(as(client), EMPLOYEE, {})

    expect(result).toEqual([])
    expect(client.aiProposal.findMany).not.toHaveBeenCalled()
  })
})

describe('AiProposalService.getById', () => {
  it('404s a missing proposal', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(null)
    const { service } = makeService()

    await expect(service.getById(as(client), HR, 'nope')).rejects.toThrow(NotFoundException)
  })

  it('lets a global HR read any proposal', async () => {
    const client = makeClient()
    const proposal = { id: 'p1', state: AiProposalState.DRAFT, shiftId: SHIFT_ID, candidates: [] }
    client.aiProposal.findUnique.mockResolvedValue(proposal)
    const { service } = makeService()

    expect(await service.getById(as(client), HR, 'p1')).toBe(proposal)
  })

  it('forbids an employee who is not the active PENDING candidate', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue({
      id: 'p1',
      state: AiProposalState.PENDING_EMPLOYEE_CONSENT,
      shiftId: SHIFT_ID,
      activeCandidateId: 'cand-x',
      candidates: [{ id: 'cand-x', employeeId: 'someone-else', consentState: ConsentState.PENDING }],
    })
    client.employee.findFirst.mockResolvedValue({ id: 'emp-me' })
    const { service } = makeService()

    await expect(service.getById(as(client), EMPLOYEE, 'p1')).rejects.toThrow(ForbiddenException)
  })
})

// --- Task 1.4: consent + manager approval + transactional commit -------------------------------

const C1 = 'emp-c1'
const C2 = 'emp-c2'

/** A PENDING_EMPLOYEE_CONSENT proposal: rank-1 `C1` is the active PENDING candidate, `C2` waits. */
function pendingConsentProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    state: AiProposalState.PENDING_EMPLOYEE_CONSENT,
    shiftId: SHIFT_ID,
    vacatedEmployeeId: VACATED,
    activeCandidateId: 'cand-1',
    candidates: [
      { id: 'cand-1', employeeId: C1, rank: 1, feasible: true, consentState: ConsentState.PENDING },
      { id: 'cand-2', employeeId: C2, rank: 2, feasible: true, consentState: ConsentState.NOT_ASKED },
    ],
    ...overrides,
  }
}

/** A PENDING_MANAGER proposal: the active candidate `C1` has GRANTED consent, ready to commit. */
function pendingManagerProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    state: AiProposalState.PENDING_MANAGER,
    shiftId: SHIFT_ID,
    vacatedEmployeeId: VACATED,
    activeCandidateId: 'cand-1',
    candidates: [
      { id: 'cand-1', employeeId: C1, rank: 1, feasible: true, consentState: ConsentState.GRANTED },
    ],
    ...overrides,
  }
}

describe('AiProposalService.employeeConsent', () => {
  it('forbids a NON-active/other employee from answering the consent request', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingConsentProposal())
    client.employee.findFirst.mockResolvedValue({ id: C2 }) // C2 is not the active candidate (C1)
    const { service } = makeService()

    await expect(service.employeeConsent(as(client), EMPLOYEE, 'prop-1', true)).rejects.toThrow(ForbiddenException)
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(client.__tx.aiProposalCandidate.update).not.toHaveBeenCalled()
  })

  it('conflicts when the proposal is not awaiting employee consent', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingConsentProposal({ state: AiProposalState.DRAFT }))
    client.employee.findFirst.mockResolvedValue({ id: C1 })
    const { service } = makeService()

    await expect(service.employeeConsent(as(client), EMPLOYEE, 'prop-1', true)).rejects.toThrow(ConflictException)
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it('accept → active candidate GRANTED (+ consentAt) and state advances to PENDING_MANAGER, all inside one transaction', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingConsentProposal())
    client.employee.findFirst.mockResolvedValue({ id: C1 })
    const { service, audit } = makeService()

    await service.employeeConsent(as(client), EMPLOYEE, 'prop-1', true)

    expect(client.$transaction).toHaveBeenCalledTimes(1)
    const tx = client.__tx
    expect(tx.aiProposalCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: { consentState: ConsentState.GRANTED, consentAt: expect.any(Date) },
    })
    expect(tx.aiProposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'prop-1', state: AiProposalState.PENDING_EMPLOYEE_CONSENT },
      data: { state: AiProposalState.PENDING_MANAGER },
    })
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_proposal.consented' }))
  })

  it('accept: optimistic lock — proposal flip matches zero rows → ConflictException, no audit', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingConsentProposal())
    client.employee.findFirst.mockResolvedValue({ id: C1 })
    client.__tx.aiProposal.updateMany.mockResolvedValue({ count: 0 })
    const { service, audit } = makeService()

    await expect(service.employeeConsent(as(client), EMPLOYEE, 'prop-1', true)).rejects.toThrow(ConflictException)
    expect(audit.log).not.toHaveBeenCalled()
  })

  it('decline with a remaining candidate → next becomes active PENDING, state stays PENDING_EMPLOYEE_CONSENT, all inside one transaction', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingConsentProposal())
    client.employee.findFirst.mockResolvedValue({ id: C1 })
    const { service } = makeService()

    await service.employeeConsent(as(client), EMPLOYEE, 'prop-1', false)

    expect(client.$transaction).toHaveBeenCalledTimes(1)
    const tx = client.__tx
    // The declined candidate is marked DECLINED...
    expect(tx.aiProposalCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: { consentState: ConsentState.DECLINED },
    })
    // ...and the next feasible NOT_ASKED candidate is promoted to the active PENDING slot.
    expect(tx.aiProposalCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-2' },
      data: { consentState: ConsentState.PENDING, consentRequestedAt: expect.any(Date) },
    })
    expect(tx.aiProposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'prop-1', state: AiProposalState.PENDING_EMPLOYEE_CONSENT },
      data: { state: AiProposalState.PENDING_EMPLOYEE_CONSENT, activeCandidateId: 'cand-2' },
    })
  })

  it('decline: optimistic lock — proposal flip matches zero rows → ConflictException', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingConsentProposal())
    client.employee.findFirst.mockResolvedValue({ id: C1 })
    client.__tx.aiProposal.updateMany.mockResolvedValue({ count: 0 })
    const { service } = makeService()

    await expect(service.employeeConsent(as(client), EMPLOYEE, 'prop-1', false)).rejects.toThrow(ConflictException)
  })

  it('decline with NO candidate left → ESCALATED and audits ai_proposal.escalated, all inside one transaction', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(
      pendingConsentProposal({
        candidates: [
          { id: 'cand-1', employeeId: C1, rank: 1, feasible: true, consentState: ConsentState.PENDING },
        ],
      }),
    )
    client.employee.findFirst.mockResolvedValue({ id: C1 })
    const { service, audit } = makeService()

    await service.employeeConsent(as(client), EMPLOYEE, 'prop-1', false)

    expect(client.$transaction).toHaveBeenCalledTimes(1)
    const tx = client.__tx
    expect(tx.aiProposalCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: { consentState: ConsentState.DECLINED },
    })
    expect(tx.aiProposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'prop-1', state: AiProposalState.PENDING_EMPLOYEE_CONSENT },
      data: { state: AiProposalState.ESCALATED },
    })
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_proposal.escalated' }))
  })
})

describe('AiProposalService.managerDecision', () => {
  it('forbids a PRACOWNIK (manages no unit) from deciding', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingManagerProposal())
    const { service } = makeService()

    await expect(service.managerDecision(as(client), EMPLOYEE, 'prop-1', { approve: true })).rejects.toThrow(
      ForbiddenException,
    )
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it('forbids a MANAGER who does not manage the shift unit', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingManagerProposal())
    client.userRole.findMany.mockResolvedValue([{ unitId: 'other-unit' }])
    const { service } = makeService()

    await expect(service.managerDecision(as(client), MANAGER, 'prop-1', { approve: true })).rejects.toThrow(
      ForbiddenException,
    )
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it('reject → REJECTED with decidedByManagerId, no shift mutation, audits ai_proposal.rejected', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingManagerProposal())
    const { service, audit } = makeService()

    await service.managerDecision(as(client), HR, 'prop-1', { approve: false })

    const upd = client.aiProposal.update.mock.calls[0][0]
    expect(upd.data.state).toBe(AiProposalState.REJECTED)
    expect(upd.data.decidedByManagerId).toBe(HR.userId)
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_proposal.rejected' }))
  })

  it('approve → re-vets the chosen candidate, reassigns the shift under the vacated guard, flips to APPROVED, audits ids-only', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingManagerProposal())
    const { service, validate } = makeService({ feasible: true })

    await service.managerDecision(as(client), HR, 'prop-1', { approve: true })

    // Re-vet ran on the FULL client with the give-away shape (incoming = the chosen candidate).
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterShift: { id: SHIFT_ID, employeeId: VACATED },
        targetShift: null,
        incomingRequesterShiftEmployeeId: C1,
        incomingTargetShiftEmployeeId: null,
      }),
    )
    const tx = client.__tx
    expect(tx.shift.updateMany).toHaveBeenCalledWith({
      where: { id: SHIFT_ID, employeeId: VACATED },
      data: { employeeId: C1 },
    })
    expect(tx.aiProposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'prop-1', state: AiProposalState.PENDING_MANAGER },
      data: { state: AiProposalState.APPROVED, decidedByManagerId: HR.userId },
    })
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1)
    const audit = tx.auditLog.create.mock.calls[0][0].data
    expect(audit.action).toBe('ai_proposal.approved')
    expect(audit.payload).toEqual({ shiftId: SHIFT_ID, from: VACATED, to: C1 })
    // No PII in the payload — ids only.
    expect(JSON.stringify(audit.payload)).not.toMatch(/pesel|home|address|adres/i)
  })

  it('re-vet INFEASIBLE → ConflictException and NO shift mutation (no transaction)', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingManagerProposal())
    const { service } = makeService({ feasible: false, feasibleReason: 'H2 rest window' })

    await expect(service.managerDecision(as(client), HR, 'prop-1', { approve: true })).rejects.toThrow(
      ConflictException,
    )
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(client.__tx.shift.updateMany).not.toHaveBeenCalled()
  })

  it('optimistic lock: shift.updateMany matches zero rows → ConflictException, proposal not flipped', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingManagerProposal())
    client.__tx.shift.updateMany.mockResolvedValue({ count: 0 })
    const { service } = makeService({ feasible: true })

    await expect(service.managerDecision(as(client), HR, 'prop-1', { approve: true })).rejects.toThrow(
      ConflictException,
    )
    expect(client.__tx.aiProposal.updateMany).not.toHaveBeenCalled()
    expect(client.__tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('optimistic lock: aiProposal flip matches zero rows → ConflictException, no audit row', async () => {
    const client = makeClient()
    client.aiProposal.findUnique.mockResolvedValue(pendingManagerProposal())
    client.__tx.aiProposal.updateMany.mockResolvedValue({ count: 0 })
    const { service } = makeService({ feasible: true })

    await expect(service.managerDecision(as(client), HR, 'prop-1', { approve: true })).rejects.toThrow(
      ConflictException,
    )
    expect(client.__tx.auditLog.create).not.toHaveBeenCalled()
  })
})
