import { randomUUID } from 'node:crypto'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantClient, TenantPrisma } from '@hrobot/db'
import {
  AiProposalAction,
  AiProposalState,
  AiProposalType,
  AutonomyLevel,
  ConsentState,
  nextProposalState,
} from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  type SwapFeasibilityValidator,
} from '../shift-swap/swap-feasibility-validator.js'
import { AiConfigService, type AiConfigActor } from './ai-config.service.js'
import { ReplacementService, type RankedCandidate } from './replacement.service.js'

/** A persisted AiProposal with its ranked candidate rows pre-loaded — the STABLE return shape. */
export type AiProposalRow = TenantPrisma.AiProposalGetPayload<{ include: { candidates: true } }>

/** Filter for {@link AiProposalService.list}. */
export interface ProposalListFilter {
  /** An employee's "only proposals awaiting MY consent" view. */
  mine?: boolean
  /** Narrow to a single lifecycle state. */
  state?: string
}

/** The minimal `AutonomyLevel`/`consentTtlHours` projection {@link AiConfigService.getConfig} yields. */
interface ResolvedConfig {
  autonomyLevel: AutonomyLevel
  consentTtlHours: number
}

/**
 * Creates and lists AI replacement proposals (Task 1.3). Proposal creation ranks candidates through
 * the reused {@link ReplacementService} seam, then gates the INITIAL lifecycle state on the unit's
 * configured {@link AutonomyLevel}:
 *
 *   - no feasible candidate            → ESCALATED (audit `ai_proposal.escalated`, NO_FEASIBLE_CANDIDATE)
 *   - SUGGEST_ONLY / AUTO_NOTIFY       → DRAFT (a human picks/notifies from here)
 *   - AUTO_ASK_CONSENT / AUTO_COMMIT   → PENDING_EMPLOYEE_CONSENT for the top feasible candidate IF
 *                                        that employee has a login (reachable); otherwise ESCALATED
 *                                        (EMPLOYEE_UNREACHABLE).
 *
 * Every state is derived through the pure {@link nextProposalState} machine so no illegal transition
 * can be persisted. Audit payloads carry IDs only — never PESEL/home or other PII.
 */
@Injectable()
export class AiProposalService {
  constructor(
    private readonly replacement: ReplacementService,
    private readonly aiConfig: AiConfigService,
    private readonly audit: AuditService,
    @Inject(SWAP_FEASIBILITY_VALIDATOR)
    private readonly validator: SwapFeasibilityValidator,
  ) {}

  private writeAudit(
    client: TenantClient,
    actor: AiConfigActor,
    action: string,
    proposalId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.log({
      tenantClient: client,
      actorUserId: actor.userId,
      action,
      entityType: 'AiProposal',
      entityId: proposalId,
      payload,
      ipAddress: actor.ipAddress,
    })
  }

  /**
   * Build a REPLACEMENT proposal for `shiftId`. The actor must be GLOBAL (HR/ADMIN) or manage the
   * shift's unit, else a 403. Candidates for the vacated shift are ranked and ALL persisted; the
   * initial state is autonomy-gated (see the class doc). Returns the proposal with its candidates.
   */
  async createReplacement(
    client: TenantClient,
    actor: AiConfigActor,
    shiftId: string,
    reason?: string,
  ): Promise<AiProposalRow> {
    const shift = await client.shift.findUnique({
      where: { id: shiftId },
      include: { employee: { select: { unitId: true } } },
    })
    if (!shift) throw new NotFoundException('Shift not found')

    const unitId = shift.employee.unitId
    if (!isGlobal(actor.roles)) {
      const managed = await managedUnitIds(client, actor.userId)
      if (!managed.includes(unitId)) throw new ForbiddenException('Shift is outside your scope')
    }

    const ranked = await this.replacement.rankCandidatesForShift(client, shift)
    const feasible = ranked.filter((c) => c.feasible)
    const config = (await this.aiConfig.getConfig(client, actor, unitId)) as ResolvedConfig
    const level = config.autonomyLevel

    // Client-side candidate ids so the top feasible one can be referenced as `activeCandidateId` in
    // the SAME insert (no follow-up update, no transaction needed for the create).
    const candidateSeeds = ranked.map((c) => ({ id: randomUUID(), candidate: c }))

    // --- Derive the initial state (autonomy-gated), all through the pure transition machine. -------
    let state: AiProposalState
    let auditAction: string
    let escalationReason: string | undefined
    let activeSeedId: string | undefined
    let expiresAt: Date | undefined

    if (feasible.length === 0) {
      state = nextProposalState(AiProposalState.DRAFT, AiProposalAction.DirectEscalate)
      auditAction = 'ai_proposal.escalated'
      escalationReason = 'NO_FEASIBLE_CANDIDATE'
    } else if (level === AutonomyLevel.AUTO_ASK_CONSENT || level === AutonomyLevel.AUTO_COMMIT_ON_APPROVAL) {
      const top = feasible[0]! // rank 1 (best-first); feasible is non-empty here
      const topEmployee = await client.employee.findUnique({
        where: { id: top.employeeId },
        select: { userId: true },
      })
      const reachable = topEmployee?.userId != null
      if (reachable) {
        state = nextProposalState(AiProposalState.DRAFT, AiProposalAction.AskConsent)
        auditAction = 'ai_proposal.created'
        activeSeedId = candidateSeeds.find((s) => s.candidate.employeeId === top.employeeId)!.id
        expiresAt = new Date(Date.now() + config.consentTtlHours * 60 * 60 * 1000)
      } else {
        state = nextProposalState(AiProposalState.DRAFT, AiProposalAction.DirectEscalate)
        auditAction = 'ai_proposal.escalated'
        escalationReason = 'EMPLOYEE_UNREACHABLE'
      }
    } else {
      // SUGGEST_ONLY / AUTO_NOTIFY: a human drives the next step from DRAFT.
      state = AiProposalState.DRAFT
      auditAction = 'ai_proposal.created'
    }

    const now = new Date()
    const proposal = await client.aiProposal.create({
      data: {
        type: AiProposalType.REPLACEMENT,
        state,
        shiftId,
        vacatedEmployeeId: shift.employeeId,
        ...(reason != null ? { reason } : {}),
        ...(activeSeedId != null ? { activeCandidateId: activeSeedId } : {}),
        ...(expiresAt != null ? { expiresAt } : {}),
        candidates: {
          create: candidateSeeds.map(({ id, candidate }) => this.candidateData(id, candidate, activeSeedId, now)),
        },
      },
      include: { candidates: true },
    })

    await this.writeAudit(client, actor, auditAction, proposal.id, {
      shiftId,
      vacatedEmployeeId: shift.employeeId,
      state,
      candidateCount: ranked.length,
      feasibleCount: feasible.length,
      ...(activeSeedId != null ? { activeCandidateId: activeSeedId } : {}),
      ...(escalationReason != null ? { reason: escalationReason } : {}),
    })

    return proposal
  }

  /** One candidate insert row; the active (consent-path) candidate is stamped PENDING at `now`. */
  private candidateData(
    id: string,
    candidate: RankedCandidate,
    activeSeedId: string | undefined,
    now: Date,
  ): TenantPrisma.AiProposalCandidateUncheckedCreateWithoutProposalInput {
    const isActive = activeSeedId != null && id === activeSeedId
    return {
      id,
      employeeId: candidate.employeeId,
      rank: candidate.rank,
      feasible: candidate.feasible,
      ...(candidate.reason != null ? { reason: candidate.reason } : {}),
      ...(candidate.score != null ? { score: candidate.score } : {}),
      consentState: isActive ? ConsentState.PENDING : ConsentState.NOT_ASKED,
      ...(isActive ? { consentRequestedAt: now } : {}),
    }
  }

  /**
   * List proposals for the actor. A GLOBAL actor sees every proposal; a MANAGER only those whose
   * vacated shift sits in a unit they manage. A plain employee (`mine: true`) sees ONLY proposals
   * where THEY are the active candidate whose consent is still PENDING and the proposal is in
   * PENDING_EMPLOYEE_CONSENT. An optional `state` narrows the manager/global view.
   */
  async list(client: TenantClient, actor: AiConfigActor, filter: ProposalListFilter = {}): Promise<AiProposalRow[]> {
    const global = isGlobal(actor.roles)
    const managed = global ? [] : await managedUnitIds(client, actor.userId)

    if (global || managed.length > 0) {
      const where: TenantPrisma.AiProposalWhereInput = {}
      if (!global) where.shift = { employee: { unitId: { in: managed } } }
      if (filter.state != null) where.state = filter.state as AiProposalState
      return client.aiProposal.findMany({ where, include: { candidates: true } })
    }

    // Plain employee: only their own active PENDING consent request.
    if (!filter.mine) return []
    const me = await client.employee.findFirst({ where: { user: { keycloakSub: actor.userId } }, select: { id: true } })
    if (!me) return []
    const rows = await client.aiProposal.findMany({
      where: {
        state: AiProposalState.PENDING_EMPLOYEE_CONSENT,
        candidates: { some: { employeeId: me.id, consentState: ConsentState.PENDING } },
      },
      include: { candidates: true },
    })
    return rows.filter((p) => this.isMyActivePending(p, me.id))
  }

  /** Load one proposal, applying the same scoping as {@link list} (404 missing, 403 out of scope). */
  async getById(client: TenantClient, actor: AiConfigActor, id: string): Promise<AiProposalRow> {
    const proposal = await client.aiProposal.findUnique({ where: { id }, include: { candidates: true } })
    if (!proposal) throw new NotFoundException('Proposal not found')

    if (isGlobal(actor.roles)) return proposal

    const managed = await managedUnitIds(client, actor.userId)
    if (managed.length > 0) {
      const shift = await client.shift.findUnique({
        where: { id: proposal.shiftId },
        select: { employee: { select: { unitId: true } } },
      })
      if (shift && managed.includes(shift.employee.unitId)) return proposal
    }

    // Employee path: only their own active PENDING consent request is visible.
    const me = await client.employee.findFirst({ where: { user: { keycloakSub: actor.userId } }, select: { id: true } })
    if (me && this.isMyActivePending(proposal, me.id)) return proposal

    throw new ForbiddenException('Proposal is outside your scope')
  }

  /** True iff `employeeId` is the proposal's ACTIVE candidate, still PENDING, in the consent state. */
  private isMyActivePending(proposal: AiProposalRow, employeeId: string): boolean {
    if (proposal.state !== AiProposalState.PENDING_EMPLOYEE_CONSENT) return false
    const active = proposal.candidates.find((c) => c.id === proposal.activeCandidateId)
    return active != null && active.employeeId === employeeId && active.consentState === ConsentState.PENDING
  }

  /** The caller's own Employee id (via `User.keycloakSub`), or null if they have no employee record. */
  private async myEmployeeId(client: TenantClient, actor: AiConfigActor): Promise<string | null> {
    const me = await client.employee.findFirst({
      where: { user: { keycloakSub: actor.userId } },
      select: { id: true },
    })
    return me?.id ?? null
  }

  /**
   * The asked employee answers their consent request (Task 1.4). ONLY the proposal's active candidate
   * (their own employee record) may respond, and only while the proposal awaits consent:
   *
   *   - `accept`  → their candidate is GRANTED and the proposal advances DRAFT-free through
   *                 employee_accept → submit_to_manager to PENDING_MANAGER (audit `ai_proposal.consented`).
   *   - decline   → their candidate is DECLINED; the NEXT feasible NOT_ASKED candidate (ascending rank)
   *                 is promoted to the active PENDING slot and the proposal stays PENDING_EMPLOYEE_CONSENT
   *                 (employee_decline_next). If none remain, the proposal ESCALATES (audit
   *                 `ai_proposal.escalated`).
   *
   * A caller who is not the asked candidate gets a 403; a wrong lifecycle state gets a 409.
   */
  async employeeConsent(
    client: TenantClient,
    actor: AiConfigActor,
    proposalId: string,
    accept: boolean,
  ): Promise<AiProposalRow> {
    const proposal = await client.aiProposal.findUnique({
      where: { id: proposalId },
      include: { candidates: true },
    })
    if (!proposal) throw new NotFoundException('Proposal not found')
    if (proposal.state !== AiProposalState.PENDING_EMPLOYEE_CONSENT) {
      throw new ConflictException('Proposal is not awaiting employee consent')
    }

    const meId = await this.myEmployeeId(client, actor)
    const active = proposal.candidates.find((c) => c.id === proposal.activeCandidateId)
    if (meId == null || active == null || active.employeeId !== meId) {
      throw new ForbiddenException('You are not the candidate being asked for consent')
    }
    if (active.consentState !== ConsentState.PENDING) {
      throw new ConflictException('Consent for this candidate is no longer pending')
    }

    const now = new Date()
    if (accept) {
      // employee_accept → EMPLOYEE_AGREED, then submit_to_manager → PENDING_MANAGER (both validated).
      const agreed = nextProposalState(proposal.state, AiProposalAction.EmployeeAccept)
      const pendingManager = nextProposalState(agreed, AiProposalAction.SubmitToManager)

      // Both writes happen atomically; the proposal flip is an optimistic-locked updateMany (guarded
      // on the state we read above) so a concurrent expire/escalate can't be silently clobbered.
      await client.$transaction(async (tx) => {
        await tx.aiProposalCandidate.update({
          where: { id: active.id },
          data: { consentState: ConsentState.GRANTED, consentAt: now },
        })
        const flipped = await tx.aiProposal.updateMany({
          where: { id: proposal.id, state: AiProposalState.PENDING_EMPLOYEE_CONSENT },
          data: { state: pendingManager },
        })
        if (flipped.count === 0) throw new ConflictException('Proposal changed concurrently')
      })

      await this.writeAudit(client, actor, 'ai_proposal.consented', proposal.id, {
        shiftId: proposal.shiftId,
        candidateId: active.id,
        employeeId: active.employeeId,
        state: pendingManager,
      })
      return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
    }

    // Decline: mark this candidate DECLINED, then promote the next feasible untouched candidate.
    const next = proposal.candidates
      .filter((c) => c.feasible && c.consentState === ConsentState.NOT_ASKED && c.id !== active.id)
      .sort((a, b) => a.rank - b.rank)[0]

    if (next) {
      // Self-loop: stays PENDING_EMPLOYEE_CONSENT, just re-pointed at the promoted candidate.
      const stay = nextProposalState(proposal.state, AiProposalAction.EmployeeDeclineNext)
      await client.$transaction(async (tx) => {
        await tx.aiProposalCandidate.update({
          where: { id: active.id },
          data: { consentState: ConsentState.DECLINED },
        })
        await tx.aiProposalCandidate.update({
          where: { id: next.id },
          data: { consentState: ConsentState.PENDING, consentRequestedAt: now },
        })
        const flipped = await tx.aiProposal.updateMany({
          where: { id: proposal.id, state: AiProposalState.PENDING_EMPLOYEE_CONSENT },
          data: { state: stay, activeCandidateId: next.id },
        })
        if (flipped.count === 0) throw new ConflictException('Proposal changed concurrently')
      })
      return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
    }

    // No candidate left to ask — escalate to a human.
    const escalated = nextProposalState(proposal.state, AiProposalAction.EmployeeDeclineLast)
    await client.$transaction(async (tx) => {
      await tx.aiProposalCandidate.update({
        where: { id: active.id },
        data: { consentState: ConsentState.DECLINED },
      })
      const flipped = await tx.aiProposal.updateMany({
        where: { id: proposal.id, state: AiProposalState.PENDING_EMPLOYEE_CONSENT },
        data: { state: escalated },
      })
      if (flipped.count === 0) throw new ConflictException('Proposal changed concurrently')
    })
    await this.writeAudit(client, actor, 'ai_proposal.escalated', proposal.id, {
      shiftId: proposal.shiftId,
      reason: 'ALL_CANDIDATES_DECLINED',
    })
    return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
  }

  /**
   * A manager decides a PENDING_MANAGER proposal (Task 1.4). The actor must be GLOBAL (HR/ADMIN) or
   * manage the vacated shift's unit, else a 403; a wrong lifecycle state is a 409.
   *
   *   - reject  → REJECTED, `decidedByManagerId` recorded (audit `ai_proposal.rejected`).
   *   - approve → the SECURITY-CRITICAL commit: the GRANTED candidate is RE-VETTED through the
   *               feasibility validator OUTSIDE the transaction (it runs its own solve on the full
   *               client); a stale/infeasible choice throws 409 with NO mutation. On success a single
   *               transaction reassigns the shift under a vacated-employee guard, flips the proposal to
   *               APPROVED under a state guard (both optimistic locks throw 409 on a concurrent change),
   *               and writes the audit row — ids only, never PII.
   */
  async managerDecision(
    client: TenantClient,
    actor: AiConfigActor,
    proposalId: string,
    { approve }: { approve: boolean },
  ): Promise<AiProposalRow> {
    const proposal = await client.aiProposal.findUnique({
      where: { id: proposalId },
      include: { candidates: true },
    })
    if (!proposal) throw new NotFoundException('Proposal not found')

    // Authorize against the vacated shift's unit.
    const shift = await client.shift.findUnique({
      where: { id: proposal.shiftId },
      select: { employee: { select: { unitId: true } } },
    })
    const unitId = shift?.employee.unitId
    if (!isGlobal(actor.roles)) {
      const managed = await managedUnitIds(client, actor.userId)
      if (unitId == null || !managed.includes(unitId)) {
        throw new ForbiddenException('Proposal is outside your scope')
      }
    }

    if (proposal.state !== AiProposalState.PENDING_MANAGER) {
      throw new ConflictException('Proposal is not awaiting a manager decision')
    }

    if (!approve) {
      const rejected = nextProposalState(proposal.state, AiProposalAction.ManagerReject)
      const updated = await client.aiProposal.update({
        where: { id: proposal.id },
        data: { state: rejected, decidedByManagerId: actor.userId },
        include: { candidates: true },
      })
      await this.writeAudit(client, actor, 'ai_proposal.rejected', proposal.id, {
        shiftId: proposal.shiftId,
      })
      return updated
    }

    // --- APPROVE: the transactional commit (Codex-reconciled pattern). ------------------------------
    const active = proposal.candidates.find((c) => c.id === proposal.activeCandidateId)
    if (active == null || active.consentState !== ConsentState.GRANTED) {
      throw new ConflictException('No consenting candidate to commit')
    }
    const chosen = active.employeeId

    // RE-VET OUTSIDE the transaction (full client — the validator runs its own solve). The give-away
    // shape vets the INCOMING candidate against H1–H4.
    const feas = await this.validator.validate({
      client,
      requesterShift: { id: proposal.shiftId, employeeId: proposal.vacatedEmployeeId },
      targetShift: null,
      incomingRequesterShiftEmployeeId: chosen,
      incomingTargetShiftEmployeeId: null,
    })
    if (!feas.feasible) throw new ConflictException(feas.reason ?? 'no longer feasible')

    await client.$transaction(async (tx) => {
      const reassigned = await tx.shift.updateMany({
        where: { id: proposal.shiftId, employeeId: proposal.vacatedEmployeeId },
        data: { employeeId: chosen },
      })
      if (reassigned.count === 0) throw new ConflictException('shift changed concurrently')

      // Derived through the pure machine (same idiom as every other transition) rather than
      // hardcoded — behaviorally identical (PENDING_MANAGER + ManagerApprove → APPROVED).
      const approved = nextProposalState(AiProposalState.PENDING_MANAGER, AiProposalAction.ManagerApprove)
      const flipped = await tx.aiProposal.updateMany({
        where: { id: proposal.id, state: AiProposalState.PENDING_MANAGER },
        data: { state: approved, decidedByManagerId: actor.userId },
      })
      if (flipped.count === 0) throw new ConflictException('proposal changed concurrently')

      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: 'ai_proposal.approved',
          entityType: 'AiProposal',
          entityId: proposal.id,
          payload: {
            shiftId: proposal.shiftId,
            from: proposal.vacatedEmployeeId,
            to: chosen,
          } as Parameters<typeof tx.auditLog.create>[0]['data']['payload'],
          ipAddress: actor.ipAddress,
        },
      })
    })

    return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
  }
}
