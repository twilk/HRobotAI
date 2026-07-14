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
 *   - AUTO_ASK_CONSENT / AUTO_COMMIT   → PENDING_EMPLOYEE_CONSENT for the FIRST feasible candidate (in
 *                                        rank order) that has a login (reachable) — Codex finding 2 —
 *                                        or ESCALATED (EMPLOYEE_UNREACHABLE) only when NONE of the
 *                                        feasible candidates are reachable.
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

    // --- Derive the initial state (autonomy-gated) AND the candidate whose Δcost becomes
    // AiProposal.estimatedCost, all through the pure transition machine. (2026-07-14 spec §12 Etap
    // 2): the COSTED candidate is the ACTIVE one when the autonomy level actually picks one
    // (AUTO_ASK_CONSENT/AUTO_COMMIT_ON_APPROVAL — which may NOT be `topFeasible`, see Codex P1-3
    // below), else the top-ranked feasible candidate for a human-reviewed DRAFT. An escalation with
    // no active candidate costs nothing (`costCandidate` stays undefined). ---------------------------
    let state: AiProposalState
    let auditAction: string
    let escalationReason: string | undefined
    let activeSeedId: string | undefined
    let expiresAt: Date | undefined
    let costCandidate: RankedCandidate | undefined

    if (feasible.length === 0) {
      state = nextProposalState(AiProposalState.DRAFT, AiProposalAction.DirectEscalate)
      auditAction = 'ai_proposal.escalated'
      escalationReason = 'NO_FEASIBLE_CANDIDATE'
    } else if (level === AutonomyLevel.AUTO_ASK_CONSENT || level === AutonomyLevel.AUTO_COMMIT_ON_APPROVAL) {
      // Codex finding 2 (P1-3, §12 Etap 2): pick the first feasible REACHABLE candidate — in rank
      // order, NOT just the top (cost-cheapest) one — as the active candidate. `RankedCandidate.
      // reachable` is already resolved by `ReplacementService` (has an `Employee.userId` ⇒ a login),
      // so a higher-ranked but unreachable candidate (e.g. a cheaper cross-unit match with no account)
      // no longer forces an escalation while a reachable candidate exists further down the ranking.
      const active = feasible.find((c) => c.reachable === true)
      if (active) {
        state = nextProposalState(AiProposalState.DRAFT, AiProposalAction.AskConsent)
        auditAction = 'ai_proposal.created'
        activeSeedId = candidateSeeds.find((s) => s.candidate.employeeId === active.employeeId)!.id
        expiresAt = new Date(Date.now() + config.consentTtlHours * 60 * 60 * 1000)
        costCandidate = active
      } else {
        state = nextProposalState(AiProposalState.DRAFT, AiProposalAction.DirectEscalate)
        auditAction = 'ai_proposal.escalated'
        escalationReason = 'EMPLOYEE_UNREACHABLE'
      }
    } else {
      // SUGGEST_ONLY / AUTO_NOTIFY: a human drives the next step from DRAFT, shown Δcost for the
      // top-ranked (cheapest total) feasible candidate.
      state = AiProposalState.DRAFT
      auditAction = 'ai_proposal.created'
      costCandidate = topFeasible
    }

    // Δcost hook (Codex P1-6, extended P2-6): labour Δ (candidate−vacated) for `costCandidate` only —
    // `null` (not 0) whenever either side's rate is missing. `estimatedCost` on the proposal is the
    // TOTAL (labour Δ + that SAME candidate's travel cost, already resolved by the ranking engine) so
    // the manager sees one bottom-line number; the per-candidate breakdown (travelKm/Minutes/Cost) is
    // persisted separately below via `candidateData` so the UI can always render "praca + dojazd =
    // razem" even though this total never overwrites/loses either component (2026-07-14 spec §12).
    const labourDelta = costCandidate
      ? await this.computeEstimatedCost(client, shift, costCandidate.employeeId, shift.employeeId)
      : null
    const estimatedCost = labourDelta != null ? labourDelta.add(costCandidate?.travelCost ?? 0) : null

    const now = new Date()
    const proposal = await client.aiProposal.create({
      data: {
        type: AiProposalType.REPLACEMENT,
        state,
        shiftId,
        vacatedEmployeeId: shift.employeeId,
        // (Codex P1-2, §12 Etap 2) The vacated shift's ORIGINAL unit, frozen here and NEVER
        // reassigned — every later authz/audit path reads THIS column, not the shift's current
        // employee's unit, so a committed cross-unit replacement never "moves" proposal ownership.
        owningUnitId: unitId,
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
      owningUnitId: unitId,
      state,
      candidateCount: ranked.length,
      feasibleCount: feasible.length,
      ...(activeSeedId != null ? { activeCandidateId: activeSeedId } : {}),
      ...(escalationReason != null ? { reason: escalationReason } : {}),
    })

    return proposal
  }

  /**
   * Labour Δcost for the given candidate replacing the vacated employee on this shift (Codex P1-6):
   * cost(candidate) − cost(vacated) for the shift's hours. `costCandidate` (2026-07-14 spec §12 Etap
   * 2) is whichever `RankedCandidate` {@link createReplacement} decided is the one to cost — the
   * ACTIVE candidate when AUTO_ASK_CONSENT/AUTO_COMMIT_ON_APPROVAL picked one, else the top-ranked
   * feasible candidate for a human-reviewed DRAFT — NEVER just "rank 1" unconditionally. This method
   * itself carries NO cost inputs (only ids), so it ALWAYS re-reads `position`/`employmentType` for
   * both employees in one query, then looks up both rates in a SECOND single query via
   * {@link CostService.findRatesForPairs}. Returns `null` (never 0) the moment either side's rate is
   * missing — a positive result means the candidate is MORE expensive than the vacated employee,
   * negative means a saving. Travel cost is DELIBERATELY excluded here (Codex P2-6) — the caller adds
   * the SAME candidate's `RankedCandidate.travelCost` on top for the proposal's total.
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
   * Authorize: GLOBAL (HR/ADMIN) or manages the proposal's FROZEN `owningUnitId` (Codex P1-2,
   * 2026-07-14 spec §12 Etap 2 — NEVER the vacated shift's current employee unit, which a committed
   * cross-unit replacement can have since moved), else 403. Wrong lifecycle state (not DRAFT) is a
   * 409. The proposal flip is an optimistic-locked `updateMany` guarded on `state: DRAFT` (same idiom
   * as every other transition in this service).
   */
  async requestConsent(client: TenantClient, actor: AiConfigActor, proposalId: string): Promise<AiProposalRow> {
    const proposal = await client.aiProposal.findUnique({
      where: { id: proposalId },
      include: { candidates: true },
    })
    if (!proposal) throw new NotFoundException('Proposal not found')

    const unitId = proposal.owningUnitId
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
        owningUnitId: unitId,
        reason: 'NO_FEASIBLE_CANDIDATE',
      })
      return client.aiProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { candidates: true } })
    }

    const now = new Date()
    const config = (await this.aiConfig.getConfig(client, actor, unitId ?? undefined)) as ResolvedConfig
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

  /** One candidate insert row; the active (consent-path) candidate is stamped PENDING at `now`.
   *  (2026-07-14 spec §12 Etap 2) `travelKm`/`travelMinutes`/`travelCost` are copied straight FROM
   *  the ranked candidate — the engine ({@link ReplacementService}) already computed them, so this
   *  never recomputes travel; it just persists the breakdown for every candidate (local ones carry
   *  0s, not null, per the engine's contract) so the UI can render "praca + dojazd" per row, not just
   *  for the active/costed one. */
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
      ...(candidate.travelKm != null ? { travelKm: candidate.travelKm } : {}),
      ...(candidate.travelMinutes != null ? { travelMinutes: candidate.travelMinutes } : {}),
      ...(candidate.travelCost != null ? { travelCost: candidate.travelCost } : {}),
      consentState: isActive ? ConsentState.PENDING : ConsentState.NOT_ASKED,
      ...(isActive ? { consentRequestedAt: now } : {}),
    }
  }

  /**
   * List proposals for the actor. A GLOBAL actor sees every proposal; a MANAGER only those whose
   * proposal `owningUnitId` — the vacated shift's ORIGINAL unit, FROZEN at creation (Codex P1-2,
   * 2026-07-14 spec §12 Etap 2) — is one they manage. NOT the shift's current employee unit: a
   * committed cross-unit replacement never moves a proposal into the candidate's unit's view. A plain
   * employee (`mine: true`) sees ONLY proposals where THEY are the active candidate whose consent is
   * still PENDING and the proposal is in PENDING_EMPLOYEE_CONSENT. An optional `state` narrows the
   * manager/global view.
   */
  async list(client: TenantClient, actor: AiConfigActor, filter: ProposalListFilter = {}): Promise<AiProposalRow[]> {
    const global = isGlobal(actor.roles)
    const managed = global ? [] : await managedUnitIds(client, actor.userId)

    if (global || managed.length > 0) {
      const where: TenantPrisma.AiProposalWhereInput = {}
      if (!global) where.owningUnitId = { in: managed }
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

    // (Codex P1-2, §12 Etap 2) Scope by the FROZEN `owningUnitId`, not the vacated shift's CURRENT
    // employee unit — a committed cross-unit replacement never moves the proposal into the
    // candidate's unit's view.
    const managed = await managedUnitIds(client, actor.userId)
    if (managed.length > 0 && proposal.owningUnitId != null && managed.includes(proposal.owningUnitId)) {
      return proposal
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
      // Clear activeCandidateId on escalation (Codex review fix) — otherwise it keeps pointing at the
      // still-PENDING (never-answered) candidate and the manager inbox's `noCandidateAtAll` check
      // (which resolves `active` via activeCandidateId) misses this escalation path entirely, showing
      // a dead candidate row instead of NO_CANDIDATE_MESSAGE.
      data: { state: expired, activeCandidateId: null },
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
        // Clear activeCandidateId on escalation (Codex review fix) — otherwise it keeps pointing at
        // the just-DECLINED candidate and the manager inbox's `noCandidateAtAll` check misses this
        // escalation path entirely, showing the declined candidate's name/badge/cost instead of
        // NO_CANDIDATE_MESSAGE.
        data: { state: escalated, activeCandidateId: null },
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
   * manage the proposal's FROZEN `owningUnitId` (Codex P1-2, 2026-07-14 spec §12 Etap 2 — the vacated
   * shift's ORIGINAL unit, never the current employee's, which a committed cross-unit replacement can
   * have since moved), else a 403; a wrong lifecycle state is a 409.
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

    // Authorize against the FROZEN owning unit — never the vacated shift's current employee unit.
    const unitId = proposal.owningUnitId
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
