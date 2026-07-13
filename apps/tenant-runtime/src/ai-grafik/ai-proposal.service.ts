import { randomUUID } from 'node:crypto'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { TenantPrisma } from '@hrobot/db'
import {
  AiProposalAction,
  AiProposalState,
  AiProposalType,
  AutonomyLevel,
  ConsentState,
  nextProposalState,
  type EmploymentType,
} from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import {
  SWAP_FEASIBILITY_VALIDATOR,
  type SwapFeasibilityValidator,
} from '../shift-swap/swap-feasibility-validator.js'
import { CostService } from '../cost/cost.service.js'
import { normalizePosition } from '../cost/position.util.js'
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
    private readonly cost: CostService,
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
    const topFeasible = feasible[0] // rank 1 (best-first), or undefined if none feasible
    const config = (await this.aiConfig.getConfig(client, actor, unitId)) as ResolvedConfig
    const level = config.autonomyLevel

    // Client-side candidate ids so the top feasible one can be referenced as `activeCandidateId` in
    // the SAME insert (no follow-up update, no transaction needed for the create).
    const candidateSeeds = ranked.map((c) => ({ id: randomUUID(), candidate: c }))

    // Δcost hook (Codex P1-6): computed for the top feasible candidate regardless of autonomy level
    // or reachability — a DRAFT proposal still shows Δcost for the human to weigh. `null` (not 0)
    // whenever either side's rate is missing.
    const estimatedCost = topFeasible
      ? await this.computeEstimatedCost(client, shift, topFeasible.employeeId, shift.employeeId)
      : null

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
      const top = topFeasible! // feasible is non-empty here
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
        ...(estimatedCost != null ? { estimatedCost: estimatedCost.toFixed(2) } : {}),
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

  /**
   * Δcost for the top feasible candidate replacing the vacated employee on this shift (Codex P1-6):
   * cost(candidate) − cost(vacated) for the shift's hours. The ranked-candidate shape carries NO
   * cost inputs (only `employeeId`/`feasible`/`rank`/`score`/`reason`), so this ALWAYS re-reads
   * `position`/`employmentType` for both employees in one query, then looks up both rates in a
   * SECOND single query via {@link CostService.findRatesForPairs}. Returns `null` (never 0) the
   * moment either side's rate is missing — a positive result means the candidate is MORE expensive
   * than the vacated employee, negative means a saving.
   */
  private async computeEstimatedCost(
    client: TenantClient,
    shift: { start: string; end: string },
    candidateEmployeeId: string,
    vacatedEmployeeId: string,
  ): Promise<TenantPrisma.Decimal | null> {
    const employees = await client.employee.findMany({
      where: { id: { in: [candidateEmployeeId, vacatedEmployeeId] } },
      select: { id: true, position: true, employmentType: true },
    })
    const candidateEmp = employees.find((e) => e.id === candidateEmployeeId)
    const vacatedEmp = employees.find((e) => e.id === vacatedEmployeeId)
    if (!candidateEmp || !vacatedEmp) return null

    const pairKey = (position: string, employmentType: EmploymentType) =>
      `${normalizePosition(position)} ${employmentType}`

    const rates = await this.cost.findRatesForPairs(client, [
      { position: candidateEmp.position, employmentType: candidateEmp.employmentType as EmploymentType },
      { position: vacatedEmp.position, employmentType: vacatedEmp.employmentType as EmploymentType },
    ])
    const rateByKey = new Map(rates.map((r) => [pairKey(r.position, r.employmentType as EmploymentType), r]))

    const candidateRate = rateByKey.get(pairKey(candidateEmp.position, candidateEmp.employmentType as EmploymentType))
    const vacatedRate = rateByKey.get(pairKey(vacatedEmp.position, vacatedEmp.employmentType as EmploymentType))
    if (!candidateRate || !vacatedRate) return null

    // FIX 3: mirror CostService.weekCost's currencyConflict guard — never subtract across mismatched
    // currencies (e.g. PLN − EUR). A misleading number is worse than no number: return null (the
    // same "ambiguous → null" contract this method already uses for missing employees/rates).
    if (candidateRate.currency !== vacatedRate.currency) return null

    const candidateCost = this.cost.shiftCost(candidateRate, shift)
    const vacatedCost = this.cost.shiftCost(vacatedRate, shift)
    return candidateCost.sub(vacatedCost)
  }

  /**
   * MANAGER (or global HR/ADMIN) action that advances a DRAFT proposal by asking the top feasible
   * candidate for consent (Fix: DRAFT is the terminus for SUGGEST_ONLY/AUTO_NOTIFY autonomy —
   * {@link createReplacement} leaves it there with no path forward otherwise). Reuses the same
   * "promote the top feasible NOT_ASKED candidate or escalate" idiom as createReplacement's
   * AUTO_ASK_CONSENT branch and {@link employeeConsent}'s decline path (via {@link pickNextFeasibleCandidate}):
   * this NEVER skips consent or manager approval — it only ever moves DRAFT → PENDING_EMPLOYEE_CONSENT
   * (human-in-the-loop preserved) or, when no feasible candidate remains, DRAFT → ESCALATED.
   *
   * Authorize: GLOBAL (HR/ADMIN) or manages the shift's unit, else 403. Wrong lifecycle state (not
   * DRAFT) is a 409. The proposal flip is an optimistic-locked `updateMany` guarded on `state: DRAFT`
   * (same idiom as every other transition in this service).
   */
  async requestConsent(client: TenantClient, actor: AiConfigActor, proposalId: string): Promise<AiProposalRow> {
    const proposal = await client.aiProposal.findUnique({
      where: { id: proposalId },
      include: { candidates: true },
    })
    if (!proposal) throw new NotFoundException('Proposal not found')

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

    if (proposal.state !== AiProposalState.DRAFT) {
      throw new ConflictException('Proposal is not a draft')
    }

    const next = this.pickNextFeasibleCandidate(proposal.candidates)

    if (!next) {
      const escalated = nextProposalState(AiProposalState.DRAFT, AiProposalAction.DirectEscalate)
      const flipped = await client.aiProposal.updateMany({
        where: { id: proposal.id, state: AiProposalState.DRAFT },
        data: { state: escalated },
      })
      if (flipped.count === 0) throw new ConflictException('Proposal changed concurrently')
      await this.writeAudit(client, actor, 'ai_proposal.escalated', proposal.id, {
        shiftId: proposal.shiftId,
        reason: 'NO_FEASIBLE_CANDIDATE',
      })
      return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
    }

    const now = new Date()
    const config = (await this.aiConfig.getConfig(client, actor, unitId)) as ResolvedConfig
    const expiresAt = new Date(now.getTime() + config.consentTtlHours * 60 * 60 * 1000)
    const pending = nextProposalState(AiProposalState.DRAFT, AiProposalAction.AskConsent)

    await client.$transaction(async (tx) => {
      await tx.aiProposalCandidate.update({
        where: { id: next.id },
        data: { consentState: ConsentState.PENDING, consentRequestedAt: now },
      })
      const flipped = await tx.aiProposal.updateMany({
        where: { id: proposal.id, state: AiProposalState.DRAFT },
        data: { state: pending, activeCandidateId: next.id, expiresAt },
      })
      if (flipped.count === 0) throw new ConflictException('Proposal changed concurrently')
    })

    await this.writeAudit(client, actor, 'ai_proposal.consent_requested', proposal.id, {
      shiftId: proposal.shiftId,
      activeCandidateId: next.id,
      employeeId: next.employeeId,
      state: pending,
    })

    return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
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
      const rows = await client.aiProposal.findMany({ where, include: { candidates: true } })
      // Fix 2 — lazy expiry: a stale PENDING_EMPLOYEE_CONSENT row never shows as still-actionable.
      return Promise.all(rows.map((p) => this.expireIfStale(client, actor, p)))
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
    // Expire stale rows FIRST — a just-expired row no longer passes isMyActivePending (its state moved
    // off PENDING_EMPLOYEE_CONSENT), so it correctly drops out of the employee's view.
    const current = await Promise.all(rows.map((p) => this.expireIfStale(client, actor, p)))
    return current.filter((p) => this.isMyActivePending(p, me.id))
  }

  /** Load one proposal, applying the same scoping as {@link list} (404 missing, 403 out of scope). */
  async getById(client: TenantClient, actor: AiConfigActor, id: string): Promise<AiProposalRow> {
    const found = await client.aiProposal.findUnique({ where: { id }, include: { candidates: true } })
    if (!found) throw new NotFoundException('Proposal not found')

    // Fix 2 — lazy expiry: expire before returning/scoping so a stale PENDING_EMPLOYEE_CONSENT proposal
    // never reads back as still-actionable.
    const proposal = await this.expireIfStale(client, actor, found)

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

  /**
   * The top feasible NOT_ASKED candidate (ascending rank), or `undefined` if none remain. Shared by
   * {@link requestConsent}'s initial pick and {@link employeeConsent}'s decline-promotion — the "find
   * who to ask next" rule is identical in both call sites.
   */
  private pickNextFeasibleCandidate(
    candidates: AiProposalRow['candidates'],
  ): AiProposalRow['candidates'][number] | undefined {
    return candidates
      .filter((c) => c.feasible && c.consentState === ConsentState.NOT_ASKED)
      .sort((a, b) => a.rank - b.rank)[0]
  }

  /** True iff `proposal` is PENDING_EMPLOYEE_CONSENT with a `expiresAt` that has already passed. */
  private isStaleConsent(proposal: Pick<AiProposalRow, 'state' | 'expiresAt'>): boolean {
    return (
      proposal.state === AiProposalState.PENDING_EMPLOYEE_CONSENT &&
      proposal.expiresAt != null &&
      proposal.expiresAt.getTime() < Date.now()
    )
  }

  /**
   * Fix 2 — consent TTL is write-only otherwise (nothing ever reads `expiresAt`). No cron is
   * available, so expiry is LAZY: called from every read path ({@link list}, {@link getById}) and
   * before {@link employeeConsent}'s mutation. A stale PENDING_EMPLOYEE_CONSENT proposal transitions
   * expire → ESCALATED via the same optimistic-locked `updateMany` idiom as every other transition
   * (audit `ai_proposal.expired` on success). A concurrent flip (someone else's read raced this one)
   * just means the guard matches 0 rows — re-read and return the current row rather than surfacing a
   * spurious error, since lazy expiry here is best-effort bookkeeping, not a caller-facing mutation.
   * Returns `proposal` unchanged when it isn't stale.
   */
  private async expireIfStale(
    client: TenantClient,
    actor: AiConfigActor,
    proposal: AiProposalRow,
  ): Promise<AiProposalRow> {
    if (!this.isStaleConsent(proposal)) return proposal

    const expired = nextProposalState(AiProposalState.PENDING_EMPLOYEE_CONSENT, AiProposalAction.Expire)
    const flipped = await client.aiProposal.updateMany({
      where: { id: proposal.id, state: AiProposalState.PENDING_EMPLOYEE_CONSENT },
      data: { state: expired },
    })
    if (flipped.count > 0) {
      await this.writeAudit(client, actor, 'ai_proposal.expired', proposal.id, {
        shiftId: proposal.shiftId,
        reason: 'CONSENT_TTL_EXPIRED',
      })
    }
    return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
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

    // Fix 2 — a past-TTL employee action can't slip through: expire first, then reject with a
    // dedicated message (distinct from the generic wrong-state 409 below).
    if (this.isStaleConsent(proposal)) {
      await this.expireIfStale(client, actor, proposal)
      throw new ConflictException('consent request expired')
    }

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
    // (`active` is PENDING, never NOT_ASKED, so it's already excluded by pickNextFeasibleCandidate.)
    const next = this.pickNextFeasibleCandidate(proposal.candidates)

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
