import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { LeaveService } from '../leave/leave.service.js'
import { GrafikService } from '../grafik/grafik.service.js'
import { ShiftSwapService } from '../shift-swap/shift-swap.service.js'
import { ZastepstwaService } from '../zastepstwa/zastepstwa.service.js'
import type { KandydatZapytaniaDto } from '../zastepstwa/dto/rozpocznij-poszukiwanie.dto.js'
import type { CreateLeaveDto } from '../leave/dto/leave.dto.js'
import { drawsDownAnnualEntitlement } from '../common/leave-type.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { windowMinutes, isoWeekRange } from '../ai-grafik/week-range.util.js'
import { parseIntent, CONFIDENCE_THRESHOLD, INTENT_CATALOG, type AgentIntent, type ParsedEntities } from './intent.util.js'

/** Flat statutory annual entitlement (KP art. 154 §1) — mirrors `analityk/analityk.service.ts`
 * `WYMIAR_URLOPU_DNI`. Duplicated here (not imported) because `agent-glosowy` never depends on
 * `analityk`'s scoped/unit machinery — only the same flat constant. Keep both in sync by hand. */
const WYMIAR_URLOPU_DNI = 20

/** Inclusive calendar-day span of a leave interval — SALDO_URLOPU keeps this simple (calendar days,
 * not business days like `analityk`'s richer report) since the agent answers a quick voice question,
 * not a compliance report. */
function inclusiveDaySpan(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1
}

/** Round to 2 decimals (avoids float noise like 23.999999999999996 in a spoken/displayed figure). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Count of Mon–Fri calendar days in the INCLUSIVE `[fromISO, toISO]` range — the denominator for
 * MOJA_EWIDENCJA's weekly-norm figure (`etat × 8h × business days`), mirroring `analityk`'s norm
 * formula (see `analityk.service.ts` `czasPracy`) at the scale of a single agent-glosowy answer. */
function businessDaysCount(fromISO: string, toISO: string): number {
  let count = 0
  let cursor = new Date(`${fromISO}T00:00:00.000Z`)
  const end = new Date(`${toISO}T00:00:00.000Z`)
  while (cursor.getTime() <= end.getTime()) {
    const dow = cursor.getUTCDay()
    if (dow !== 0 && dow !== 6) count++
    cursor = new Date(cursor.getTime() + 86400000)
  }
  return count
}

/**
 * The acting user projected from the JWT + IP — structurally identical to `LeaveActor`/`GrafikActor`
 * so the agent can hand it straight through to those services and act AS the caller (no new
 * authority of its own). All RBAC/scoping/maker-checker rules are enforced by the REAL services.
 */
export interface VoiceActor {
  userId: string
  roles: string[]
  ipAddress: string
}

export type ProposedActionKind =
  | 'CREATE_LEAVE'
  | 'READ_SCHEDULE'
  | 'READ_LEAVE_BALANCE'
  | 'READ_LEAVE_STATUS'
  | 'READ_HELP'
  | 'READ_WHO_WORKS'
  | 'READ_NEXT_SHIFT'
  | 'READ_TIMESHEET'
  | 'CANCEL_LEAVE'
  | 'CREATE_SHIFT_SWAP'
  | 'START_REPLACEMENT_SEARCH'
  | 'NONE'

/** A description of what WOULD happen — never a side effect. `interpret` returns this; nothing runs. */
export interface ProposedAction {
  kind: ProposedActionKind
  method?: 'POST' | 'GET'
  endpoint?: string
  body?: Record<string, unknown>
}

export interface InterpretResult {
  intent: AgentIntent
  entities: ParsedEntities
  confidence: number
  /** Write intents (URLOP/L4) → true. A read (MOJ_GRAFIK) → false. */
  requiresConfirmation: boolean
  /** NIEZNANE or sub-threshold confidence → the UI must show a manual form, never guess-execute. */
  fallbackToForm: boolean
  proposedAction: ProposedAction
  humanReadable: string
  aiNotice: string
}

export interface ExecuteParams {
  intent: AgentIntent
  entities: ParsedEntities
  /** Human confirmation flag — REQUIRED (`true`) for a write intent. */
  confirm?: boolean
}

export interface ExecuteResult {
  executed: boolean
  intent: AgentIntent
  requiresConfirmation: boolean
  fallbackToForm: boolean
  result?: unknown
  humanReadable: string
  aiNotice: string
  /** True only on a write that a human explicitly confirmed (art. 22 audit trail). */
  confirmedByHuman?: boolean
}

/** EU AI Act transparency: every result states plainly that this is an AI assistant. */
const AI_NOTICE =
  'Asystent AI HRobot — rozmawiasz z systemem AI (nie z człowiekiem). Akcje zapisujące wymagają potwierdzenia człowieka.'

const LEAVE_TYPE_BY_INTENT: Record<'URLOP' | 'L4', string> = {
  URLOP: 'URLOP_WYPOCZYNKOWY',
  L4: 'ZWOLNIENIE_LEKARSKIE',
}

const WRITE_INTENTS: ReadonlySet<AgentIntent> = new Set<AgentIntent>([
  'URLOP',
  'L4',
  'ANULUJ_WNIOSEK',
  'ZAMIANA_ZMIANY',
  'ZNAJDZ_ZASTEPSTWO',
])

/**
 * [RBAC GAP GUARD] `ZastepstwaController` gates `POST /zastepstwa` to MANAGER/HR/ADMIN_KLIENTA
 * (`KADROWY_ROLES` in `zastepstwa.controller.ts`) — but `ZastepstwaService.rozpocznij` itself has NO
 * internal role check; the guard lives ONLY on the HTTP route. Calling the service directly via DI
 * (as this agent does) bypasses that route entirely, so WITHOUT this explicit check a PRACOWNIK could
 * use the voice agent to trigger `zastepstwa` outreach — a capability a keyboard PRACOWNIK does not
 * have. Mirrors `KADROWY_ROLES` exactly; see the dedicated RBAC test in
 * `voice-command.service.spec.ts`.
 */
const KADROWY_ROLES: ReadonlySet<string> = new Set([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])

/**
 * Renders POMOC's help text FROM {@link INTENT_CATALOG} — never a hand-copied string. Growing the
 * command set means adding one row to `INTENT_CATALOG`; this function (and therefore POMOC's
 * output) picks it up on its own. See `voice-command.service.spec.ts` for the test that enforces
 * this by iterating the catalog at test-run time rather than asserting a fixed string.
 */
function buildPomocText(): string {
  const lines = INTENT_CATALOG.filter((e) => e.intent !== 'POMOC').map((e) => `- ${e.opis} (np. „${e.przyklad}”)`)
  return ['Dostępne polecenia:', ...lines].join('\n')
}

function toISODate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') return value.slice(0, 10)
  return undefined
}

/**
 * `agent-glosowy` orchestration brain (M3 module 3, spec §4–§6). Turns a parsed Polish utterance
 * into either a PROPOSAL ({@link interpret} — describes, never runs) or an ACTION ({@link execute} —
 * runs behind a human-confirmation gate for writes).
 *
 * It is a THIN bridge, NOT a new authorizer: it calls the REAL {@link LeaveService.createRequest}
 * (K1 urlop / K2 L4) and {@link GrafikService.listShifts} (K3 mój grafik) with the SAME actor and
 * tenant client the HTTP request carried, so every RBAC/scoping/maker-checker rule is enforced by
 * those services exactly as for a keyboard user — no privilege escalation is possible here.
 *
 * Human-in-the-loop (EU AI Act + RODO art. 22): a write intent CANNOT execute without `confirm ===
 * true` (throws otherwise); a read may run directly. NIEZNANE / low-confidence NEVER executes — it
 * returns a "fall back to the manual form" result. Every execution writes an IDS-ONLY audit row.
 */
@Injectable()
export class VoiceCommandService {
  constructor(
    private readonly leave: LeaveService,
    private readonly grafik: GrafikService,
    private readonly audit: AuditService,
    private readonly shiftSwap: ShiftSwapService,
    private readonly zastepstwa: ZastepstwaService,
  ) {}

  /**
   * Parse `text` and DESCRIBE what would happen. Pure planning: it performs NO write and NO read of
   * tenant data — it only shapes a {@link ProposedAction} + human-readable preview + confirmation
   * requirement. Low confidence / NIEZNANE → `fallbackToForm: true` (the UI shows a manual form).
   */
  interpret(text: string, today: Date, _actor: VoiceActor): InterpretResult {
    const { intent, entities, confidence } = parseIntent(text, today)
    const base = { intent, entities, confidence, aiNotice: AI_NOTICE }

    if (intent === 'NIEZNANE' || confidence < CONFIDENCE_THRESHOLD) {
      return {
        ...base,
        requiresConfirmation: false,
        fallbackToForm: true,
        proposedAction: { kind: 'NONE' },
        humanReadable:
          'Nie rozpoznano polecenia z wystarczającą pewnością — wypełnij formularz ręcznie (nie wykonuję akcji „w ciemno").',
      }
    }

    if (intent === 'POMOC') {
      return {
        ...base,
        requiresConfirmation: false,
        fallbackToForm: false,
        proposedAction: { kind: 'READ_HELP' },
        humanReadable: buildPomocText(),
      }
    }

    if (intent === 'URLOP' || intent === 'L4') {
      const type = entities.type ?? LEAVE_TYPE_BY_INTENT[intent]
      return {
        ...base,
        requiresConfirmation: true,
        fallbackToForm: false,
        proposedAction: {
          kind: 'CREATE_LEAVE',
          method: 'POST',
          endpoint: '/api/wnioski',
          body: { startDate: entities.dateFrom, endDate: entities.dateTo ?? entities.dateFrom, type },
        },
        humanReadable: `Czy złożyć wniosek (${type}) od ${entities.dateFrom} do ${entities.dateTo ?? entities.dateFrom}? Wymagane potwierdzenie.`,
      }
    }

    if (intent === 'ANULUJ_WNIOSEK') {
      return {
        ...base,
        requiresConfirmation: true,
        fallbackToForm: false,
        proposedAction: { kind: 'CANCEL_LEAVE', method: 'POST', endpoint: '/api/wnioski/{id}/anuluj' },
        humanReadable: 'Czy anulować Twój najnowszy oczekujący wniosek? Wymagane potwierdzenie.',
      }
    }

    if (intent === 'ZAMIANA_ZMIANY') {
      return {
        ...base,
        requiresConfirmation: true,
        fallbackToForm: false,
        proposedAction: { kind: 'CREATE_SHIFT_SWAP', method: 'POST', endpoint: '/api/shift-swap', body: { date: entities.dateFrom } },
        humanReadable: `Czy zgłosić prośbę o zamianę Twojej zmiany w dniu ${entities.dateFrom}? Wymagane potwierdzenie.`,
      }
    }

    if (intent === 'ZNAJDZ_ZASTEPSTWO') {
      return {
        ...base,
        requiresConfirmation: true,
        fallbackToForm: false,
        proposedAction: { kind: 'START_REPLACEMENT_SEARCH', method: 'POST', endpoint: '/api/zastepstwa', body: { date: entities.dateFrom } },
        humanReadable: `Czy rozpocząć poszukiwanie zastępstwa na zmianę w dniu ${entities.dateFrom}? Wyślemy zapytania do dostępnych pracowników. Wymagane potwierdzenie.`,
      }
    }

    if (intent === 'SALDO_URLOPU') {
      return {
        ...base,
        requiresConfirmation: false,
        fallbackToForm: false,
        proposedAction: { kind: 'READ_LEAVE_BALANCE', method: 'GET', endpoint: '/api/wnioski?mine=true&state=APPROVED' },
        humanReadable: 'Twoje saldo urlopu wypoczynkowego.',
      }
    }

    if (intent === 'STATUS_WNIOSKU') {
      return {
        ...base,
        requiresConfirmation: false,
        fallbackToForm: false,
        proposedAction: { kind: 'READ_LEAVE_STATUS', method: 'GET', endpoint: '/api/wnioski?mine=true' },
        humanReadable: 'Status Twojego najnowszego wniosku.',
      }
    }

    if (intent === 'KTO_PRACUJE') {
      return {
        ...base,
        requiresConfirmation: false,
        fallbackToForm: false,
        proposedAction: {
          kind: 'READ_WHO_WORKS',
          method: 'GET',
          endpoint: '/api/grafik/shifts',
          body: { date: entities.dateFrom },
        },
        humanReadable: `Kto pracuje ${entities.dateFrom} (zakres zależny od Twojej roli).`,
      }
    }

    if (intent === 'NASTEPNA_ZMIANA') {
      return {
        ...base,
        requiresConfirmation: false,
        fallbackToForm: false,
        proposedAction: { kind: 'READ_NEXT_SHIFT', method: 'GET', endpoint: '/api/grafik/shifts' },
        humanReadable: 'Twoja najbliższa zaplanowana zmiana.',
      }
    }

    if (intent === 'MOJA_EWIDENCJA') {
      return {
        ...base,
        requiresConfirmation: false,
        fallbackToForm: false,
        proposedAction: {
          kind: 'READ_TIMESHEET',
          method: 'GET',
          endpoint: '/api/grafik/shifts',
          body: { dateFrom: entities.dateFrom, dateTo: entities.dateTo },
        },
        humanReadable: `Twoja ewidencja czasu pracy od ${entities.dateFrom} do ${entities.dateTo}.`,
      }
    }

    // MOJ_GRAFIK (read)
    return {
      ...base,
      requiresConfirmation: false,
      fallbackToForm: false,
      proposedAction: {
        kind: 'READ_SCHEDULE',
        method: 'GET',
        endpoint: '/api/grafik/shifts',
        body: { date: entities.dateFrom },
      },
      humanReadable: `Twój grafik na ${entities.dateFrom}.`,
    }
  }

  /**
   * Execute a previously-interpreted command. For a WRITE intent this REQUIRES `confirm === true`
   * (human-in-the-loop) — otherwise it throws and nothing is written. Reads run directly. NIEZNANE
   * never executes. Every executed command writes an IDS-ONLY audit row via {@link AuditService}.
   */
  async execute(client: TenantClient, actor: VoiceActor, params: ExecuteParams, today: Date): Promise<ExecuteResult> {
    const { intent, entities, confirm } = params
    const base = { intent, aiNotice: AI_NOTICE }

    if (intent === 'NIEZNANE') {
      return {
        ...base,
        executed: false,
        requiresConfirmation: false,
        fallbackToForm: true,
        humanReadable: 'Nie rozpoznano polecenia — użyj formularza. Nie wykonano żadnej akcji.',
      }
    }

    if (intent === 'POMOC') {
      await this.audit.log({
        tenantClient: client,
        actorUserId: actor.userId,
        action: 'agent-glosowy.execute',
        entityType: 'Help',
        entityId: 'n/a',
        payload: { intent },
        ipAddress: actor.ipAddress,
      })
      return {
        ...base,
        executed: true,
        requiresConfirmation: false,
        fallbackToForm: false,
        humanReadable: buildPomocText(),
      }
    }

    if (WRITE_INTENTS.has(intent)) {
      // [EU AI Act / RODO art. 22] hard human-in-the-loop gate: no confirmation → no write. Shared
      // by EVERY write intent below — nothing in this block runs before it.
      if (confirm !== true) {
        throw new BadRequestException(
          'Potwierdzenie człowieka jest wymagane przed wykonaniem tej akcji (nadzór człowieka — EU AI Act / art. 22 RODO).',
        )
      }

      if (intent === 'URLOP' || intent === 'L4') {
        if (entities.dateFrom == null) {
          throw new BadRequestException('Brak daty początkowej — nie można złożyć wniosku.')
        }

        const type = entities.type ?? LEAVE_TYPE_BY_INTENT[intent]
        const dto: CreateLeaveDto = {
          startDate: entities.dateFrom,
          endDate: entities.dateTo ?? entities.dateFrom,
          type,
        }
        // Reuse the REAL leave service AS the actor — its RBAC + PENDING + maker-checker rules apply.
        const created = (await this.leave.createRequest(client, actor, dto)) as { id: string; employeeId: string }

        await this.audit.log({
          tenantClient: client,
          actorUserId: actor.userId,
          action: 'agent-glosowy.execute',
          entityType: 'LeaveRequest',
          entityId: created.id,
          payload: { intent, leaveRequestId: created.id, employeeId: created.employeeId },
          ipAddress: actor.ipAddress,
        })

        return {
          ...base,
          executed: true,
          requiresConfirmation: false,
          fallbackToForm: false,
          confirmedByHuman: true,
          result: created,
          humanReadable: `Złożono wniosek (${type}) od ${dto.startDate} do ${dto.endDate} — status: do decyzji przełożonego.`,
        }
      }

      // ANULUJ_WNIOSEK: cancel the caller's own most-recent PENDING request. `LeaveService.cancel`
      // already enforces "only the requester, only while PENDING" — we just pick WHICH one (the
      // agent has no id-slot in its closed vocabulary, so "my latest pending request" is the only
      // unambiguous target a voice command can name).
      if (intent === 'ANULUJ_WNIOSEK') {
        const mine = (await this.leave.list(client, actor, { mine: true, state: 'PENDING' })) as Array<{
          id: string
          type: string
          startDate: Date
          endDate: Date
        }>
        const target = mine[0] // LeaveService.list orders createdAt desc → [0] is the most recent.
        if (!target) {
          return {
            ...base,
            executed: false,
            requiresConfirmation: false,
            fallbackToForm: false,
            humanReadable: 'Nie masz żadnego oczekującego wniosku do anulowania.',
          }
        }

        const cancelled = (await this.leave.cancel(client, actor, target.id)) as {
          id: string
          type: string
          startDate: Date
          endDate: Date
        }

        await this.audit.log({
          tenantClient: client,
          actorUserId: actor.userId,
          action: 'agent-glosowy.execute',
          entityType: 'LeaveRequest',
          entityId: cancelled.id,
          payload: { intent, leaveRequestId: cancelled.id },
          ipAddress: actor.ipAddress,
        })

        return {
          ...base,
          executed: true,
          requiresConfirmation: false,
          fallbackToForm: false,
          confirmedByHuman: true,
          result: cancelled,
          humanReadable: `Anulowano wniosek (${cancelled.type}) od ${toISODate(cancelled.startDate)} do ${toISODate(cancelled.endDate)}.`,
        }
      }

      // ZAMIANA_ZMIANY: a "give away" swap request (no named counterparty — the closed vocabulary
      // has no way to name a colleague) for the caller's OWN shift on the spoken day, created via
      // the REAL ShiftSwapService and immediately submitted (DRAFT → PENDING_PEER) so a colleague
      // can actually act on it. The manager approval / actual reassignment stays entirely inside
      // `ShiftSwapService` — this agent only starts the request, exactly like a keyboard user would.
      if (intent === 'ZAMIANA_ZMIANY') {
        if (entities.dateFrom == null) {
          throw new BadRequestException('Brak daty — nie można zgłosić zamiany zmiany.')
        }
        const date = entities.dateFrom
        const myId = await this.ownEmployeeId(client, actor)
        const all = (await this.grafik.listShifts(client, actor)) as Array<{ id: string; employeeId: string; date: unknown }>
        // Defense-in-depth own-filter (see KTO_PRACUJE/NASTEPNA_ZMIANA/MOJA_EWIDENCJA).
        const mine = all.filter((s) => myId != null && s.employeeId === myId && toISODate(s.date) === date)
        const target = mine[0]
        if (!target) {
          return {
            ...base,
            executed: false,
            requiresConfirmation: false,
            fallbackToForm: false,
            humanReadable: `Nie masz zmiany w dniu ${date} — nie można zgłosić zamiany.`,
          }
        }

        const created = (await this.shiftSwap.create(client, { userId: actor.userId, roles: actor.roles }, { requesterShiftId: target.id })) as { id: string }
        const submitted = await this.shiftSwap.submit(client, created.id)

        await this.audit.log({
          tenantClient: client,
          actorUserId: actor.userId,
          action: 'agent-glosowy.execute',
          entityType: 'ShiftSwapRequest',
          entityId: created.id,
          payload: { intent, shiftSwapRequestId: created.id, shiftId: target.id },
          ipAddress: actor.ipAddress,
        })

        return {
          ...base,
          executed: true,
          requiresConfirmation: false,
          fallbackToForm: false,
          confirmedByHuman: true,
          result: submitted,
          humanReadable: `Zgłoszono prośbę o zamianę zmiany z dnia ${date} — czeka na przyjęcie przez innego pracownika.`,
        }
      }

      // ZNAJDZ_ZASTEPSTWO: START a replacement search for the caller's OWN shift on the spoken day.
      // [GRANICA ZGODNOŚCI — art. 22 RODO] this call can only ever reach ZastepstwaService.rozpocznij,
      // which sends outreach and can land the process in SUKCES/WYCZERPANO — it can NEVER itself
      // produce POTWIERDZONE_PRZEZ_CZLOWIEKA (only `ZastepstwaService.potwierdz`, called from an
      // explicit manager action on the real controller, can do that — this agent never calls it).
      // Granting leave / reassigning the shift remains a separate, human, downstream decision.
      if (intent === 'ZNAJDZ_ZASTEPSTWO') {
        if (!actor.roles.some((r) => KADROWY_ROLES.has(r))) {
          throw new ForbiddenException(
            'Rozpoczęcie poszukiwania zastępstwa wymaga roli managera, HR lub administratora.',
          )
        }
        if (entities.dateFrom == null) {
          throw new BadRequestException('Brak daty — nie można rozpocząć poszukiwania zastępstwa.')
        }
        const date = entities.dateFrom
        const myId = await this.ownEmployeeId(client, actor)
        const all = (await this.grafik.listShifts(client, actor)) as Array<{
          id: string
          employeeId: string
          date: unknown
          start: string
          end: string
          role?: string
        }>
        const mine = all.filter((s) => myId != null && s.employeeId === myId && toISODate(s.date) === date)
        const target = mine[0]
        if (!target) {
          return {
            ...base,
            executed: false,
            requiresConfirmation: false,
            fallbackToForm: false,
            humanReadable: `Nie masz zmiany w dniu ${date} — nie można rozpocząć poszukiwania zastępstwa.`,
          }
        }

        // Candidate roster: the SAME global/managed-unit scope `EmployeesService.list` and
        // `GrafikService.listShifts` already use for MANAGER/HR/ADMIN (see KTO_PRACUJE above) — the
        // caller passed the KADROWY_ROLES gate above, so this scope is exactly what they may see.
        const managed = await managedUnitIds(client, actor.userId)
        const scopeUnits = isGlobal(actor.roles) ? null : managed
        const roster = (await client.employee.findMany({
          where: scopeUnits ? { unitId: { in: scopeUnits } } : {},
          select: { id: true, qualifications: true },
        })) as Array<{ id: string; qualifications: string[] }>

        const { weekStart, weekEndExcl } = isoWeekRange(new Date(`${date}T00:00:00.000Z`))
        const weekStartIso = toISODate(weekStart)!
        const weekEndIso = toISODate(new Date(weekEndExcl.getTime() - 86400000))!
        const approvedLeave = (await this.leave.list(client, actor, { state: 'APPROVED' })) as Array<{
          employeeId: string
          startDate: Date
          endDate: Date
        }>

        const kandydaci: KandydatZapytaniaDto[] = roster
          .filter((e) => e.id !== myId)
          .map((e) => {
            const busyToday = all.some((s) => s.employeeId === e.id && toISODate(s.date) === date)
            const onLeaveToday = approvedLeave.some(
              (l) => l.employeeId === e.id && toISODate(l.startDate)! <= date && date <= toISODate(l.endDate)!,
            )
            const dostepny = !busyToday && !onLeaveToday
            const qualified = target.role == null || e.qualifications.includes(target.role)
            const wykonalnaZamiana = dostepny && qualified
            const obciazenieTygodnioweGodz = round2(
              all
                .filter((s) => s.employeeId === e.id && (toISODate(s.date) ?? '') >= weekStartIso && (toISODate(s.date) ?? '') <= weekEndIso)
                .reduce((sum, s) => sum + windowMinutes(s.start, s.end) / 60, 0),
            )
            return {
              pracownikId: e.id,
              dostepny,
              wykonalnaZamiana,
              ...(wykonalnaZamiana ? {} : { powodNiewykonalnosci: !dostepny ? 'zajęty lub nieobecny w tym dniu' : 'brak wymaganych kwalifikacji' }),
              obciazenieTygodnioweGodz,
            }
          })

        if (kandydaci.length === 0) {
          return {
            ...base,
            executed: false,
            requiresConfirmation: false,
            fallbackToForm: false,
            humanReadable: 'Brak innych pracowników w Twoim zakresie — nie można rozpocząć poszukiwania zastępstwa.',
          }
        }

        // The REAL ZastepstwaService decides who to contact and in what order (ranking.py) — we only
        // supply the candidate facts, never a decision. `kwalifikujacySie` filtering — including the
        // possibility that NO candidate is dostepny/wykonalnaZamiana — is entirely its concern (it
        // lands the process in WYCZERPANO rather than KOLEJKA); we don't second-guess that here.
        const proces = await this.zastepstwa.rozpocznij({ shiftId: target.id, nieobecnyId: myId!, kandydaci })

        await this.audit.log({
          tenantClient: client,
          actorUserId: actor.userId,
          action: 'agent-glosowy.execute',
          entityType: 'ZastepstwoProces',
          entityId: (proces as { id: string }).id,
          payload: { intent, procesId: (proces as { id: string }).id, shiftId: target.id, kandydatCount: kandydaci.length },
          ipAddress: actor.ipAddress,
        })

        return {
          ...base,
          executed: true,
          requiresConfirmation: false,
          fallbackToForm: false,
          confirmedByHuman: true,
          result: proces,
          humanReadable: `Rozpoczęto poszukiwanie zastępstwa na zmianę z dnia ${date} (status: ${(proces as { stan: string }).stan}).`,
        }
      }
    }

    if (intent === 'SALDO_URLOPU') {
      // Reuse the REAL leave service, own-scoped + APPROVED only (mirrors analityk's urlopy() rule:
      // only WYPOCZYNKOWY-classified leave draws down the art. 154 pool).
      const approved = (await this.leave.list(client, actor, { mine: true, state: 'APPROVED' })) as Array<{
        startDate: Date
        endDate: Date
        type: string
      }>
      const wykorzystaneDni = approved
        .filter((l) => drawsDownAnnualEntitlement(l.type))
        .reduce((sum, l) => sum + inclusiveDaySpan(l.startDate, l.endDate), 0)
      const balance = {
        wymiarDni: WYMIAR_URLOPU_DNI,
        wykorzystaneDni,
        pozostaleDni: WYMIAR_URLOPU_DNI - wykorzystaneDni,
      }

      await this.audit.log({
        tenantClient: client,
        actorUserId: actor.userId,
        action: 'agent-glosowy.execute',
        entityType: 'LeaveBalance',
        entityId: actor.userId,
        payload: { intent, ...balance },
        ipAddress: actor.ipAddress,
      })

      return {
        ...base,
        executed: true,
        requiresConfirmation: false,
        fallbackToForm: false,
        result: balance,
        humanReadable: `Wykorzystano ${balance.wykorzystaneDni} z ${balance.wymiarDni} dni urlopu — pozostało ${balance.pozostaleDni}.`,
      }
    }

    if (intent === 'STATUS_WNIOSKU') {
      // Own requests, newest first (LeaveService.list already orders by createdAt desc) — the agent
      // answers "what's up with MY request" as the single most recent one.
      const mine = (await this.leave.list(client, actor, { mine: true })) as Array<{
        id: string
        status: string
        type: string
        startDate: Date
        endDate: Date
      }>
      const latest = mine[0] ?? null
      const result = latest
        ? {
            id: latest.id,
            status: latest.status,
            type: latest.type,
            startDate: toISODate(latest.startDate),
            endDate: toISODate(latest.endDate),
          }
        : null

      await this.audit.log({
        tenantClient: client,
        actorUserId: actor.userId,
        action: 'agent-glosowy.execute',
        entityType: 'LeaveRequest',
        entityId: latest?.id ?? 'none',
        payload: { intent, leaveRequestId: latest?.id ?? null, status: latest?.status ?? null },
        ipAddress: actor.ipAddress,
      })

      return {
        ...base,
        executed: true,
        requiresConfirmation: false,
        fallbackToForm: false,
        result,
        humanReadable: latest
          ? `Twój najnowszy wniosek (${latest.type}) od ${result?.startDate} do ${result?.endDate}: status ${latest.status}.`
          : 'Nie złożyłeś jeszcze żadnego wniosku.',
      }
    }

    if (intent === 'KTO_PRACUJE') {
      const date = entities.dateFrom ?? today.toISOString().slice(0, 10)
      const result = await this.ktoPracuje(client, actor, date)

      await this.audit.log({
        tenantClient: client,
        actorUserId: actor.userId,
        action: 'agent-glosowy.execute',
        entityType: 'Roster',
        entityId: date,
        payload: { intent, date, scoped: 'self' in result ? 'self' : 'unit-or-global' },
        ipAddress: actor.ipAddress,
      })

      return {
        ...base,
        executed: true,
        requiresConfirmation: false,
        fallbackToForm: false,
        result,
        humanReadable:
          'self' in result
            ? // Least-privilege default: a plain employee sees ONLY their own status — never a
              // roster of colleagues (that requires MANAGER/HR/ADMIN scope; see `ktoPracuje` below).
              `${result.self.working ? `Pracujesz ${date}.` : result.self.onApprovedLeave ? `Jesteś na urlopie ${date}.` : `Nie masz zaplanowanej zmiany ${date}.`} Widzisz tylko swoje dane — pytanie o innych pracownikach wymaga roli managera/HR.`
            : `Na ${date} pracuje: ${result.pracujacy.length ? result.pracujacy.join(', ') : 'nikt'}. Nieobecni: ${result.nieobecni.length ? result.nieobecni.join(', ') : 'nikt'}.`,
      }
    }

    if (intent === 'NASTEPNA_ZMIANA') {
      const myId = await this.ownEmployeeId(client, actor)
      const todayIso = today.toISOString().slice(0, 10)
      const all = (await this.grafik.listShifts(client, actor)) as Array<{ employeeId: string; date: unknown; start: string }>
      // Defense-in-depth own-filter (see KTO_PRACUJE): never trust `listShifts` alone to have
      // scoped to "just me" — a MANAGER/HR actor's call returns a wider set by design.
      const upcoming = all
        .filter((s) => myId != null && s.employeeId === myId && (toISODate(s.date) ?? '') >= todayIso)
        .sort((a, b) => (toISODate(a.date) ?? '').localeCompare(toISODate(b.date) ?? '') || a.start.localeCompare(b.start))
      const next = upcoming[0] ?? null

      await this.audit.log({
        tenantClient: client,
        actorUserId: actor.userId,
        action: 'agent-glosowy.execute',
        entityType: 'Shift',
        entityId: (next as { id?: string } | null)?.id ?? 'none',
        payload: { intent, found: next != null },
        ipAddress: actor.ipAddress,
      })

      return {
        ...base,
        executed: true,
        requiresConfirmation: false,
        fallbackToForm: false,
        result: next,
        humanReadable: next
          ? `Twoja najbliższa zmiana: ${toISODate(next.date)} (${next.start}–${(next as { end?: string }).end ?? ''}).`
          : 'Nie masz żadnych zaplanowanych zmian.',
      }
    }

    if (intent === 'MOJA_EWIDENCJA') {
      const dateFrom = entities.dateFrom!
      const dateTo = entities.dateTo ?? dateFrom
      const me = await client.employee.findFirst({ where: { user: { keycloakSub: actor.userId } }, select: { id: true, etat: true } })
      const all = (await this.grafik.listShifts(client, actor)) as Array<{ employeeId: string; date: unknown; start: string; end: string }>
      // Defense-in-depth own-filter (see KTO_PRACUJE / NASTEPNA_ZMIANA): never trust `listShifts`
      // alone to already be "just me" for a MANAGER/HR actor.
      const own = all.filter((s) => me != null && s.employeeId === me.id && (toISODate(s.date) ?? '') >= dateFrom && (toISODate(s.date) ?? '') <= dateTo)

      const sumaGodzin = round2(own.reduce((sum, s) => sum + windowMinutes(s.start, s.end) / 60, 0))
      const etat = Number(me?.etat ?? 1)
      const normaGodzin = round2(etat * 8 * businessDaysCount(dateFrom, dateTo))
      const nadwyzkaPonadNorme = round2(Math.max(0, sumaGodzin - normaGodzin))
      const niedoborDoNormy = round2(Math.max(0, normaGodzin - sumaGodzin))
      const result = { dateFrom, dateTo, sumaGodzin, normaGodzin, nadwyzkaPonadNorme, niedoborDoNormy, liczbaZmian: own.length }

      await this.audit.log({
        tenantClient: client,
        actorUserId: actor.userId,
        action: 'agent-glosowy.execute',
        entityType: 'Ewidencja',
        entityId: `${dateFrom}..${dateTo}`,
        payload: { intent, ...result },
        ipAddress: actor.ipAddress,
      })

      return {
        ...base,
        executed: true,
        requiresConfirmation: false,
        fallbackToForm: false,
        result,
        // READ THE NAME LITERALLY (mirrors `analityk`'s identical `nadwyzkaPonadNorme` disclaimer):
        // this is planned/rostered time vs the WEEKLY norm only — no daily norm (art. 151 §1), no
        // unpaid-break deduction (art. 141) — so it systematically UNDERSTATES statutory overtime
        // and must never be presented to the user as "nadgodziny" in the KP sense.
        humanReadable:
          `Ewidencja ${dateFrom}–${dateTo}: przepracowano ${sumaGodzin}h przy normie ${normaGodzin}h. ` +
          `Nadwyżka ponad normę tygodniową: ${nadwyzkaPonadNorme}h (niedobór: ${niedoborDoNormy}h). ` +
          'UWAGA: to nie są nadgodziny w rozumieniu Kodeksu pracy (bez normy dobowej i bez odliczenia przerwy) — to nadwyżka ponad normę tygodniową z grafiku.',
      }
    }

    // MOJ_GRAFIK (read) — safe to run directly, no confirmation.
    const date = entities.dateFrom ?? today.toISOString().slice(0, 10)
    const all = (await this.grafik.listShifts(client, actor)) as Array<Record<string, unknown>>
    const shifts = all.filter((s) => toISODate(s['date']) === date)

    await this.audit.log({
      tenantClient: client,
      actorUserId: actor.userId,
      action: 'agent-glosowy.execute',
      entityType: 'Shift',
      entityId: date,
      payload: { intent, date, shiftCount: shifts.length },
      ipAddress: actor.ipAddress,
    })

    return {
      ...base,
      executed: true,
      requiresConfirmation: false,
      fallbackToForm: false,
      result: shifts,
      humanReadable: `Twój grafik na ${date}: ${shifts.length} zmian(y).`,
    }
  }

  // --- KTO_PRACUJE -----------------------------------------------------------------------------

  /**
   * The caller's OWN Employee id, resolved via their Keycloak subject — mirrors the identical
   * `ownEmployeeId` helper private to `LeaveService`/`GrafikService`. Reading this can NEVER leak
   * another employee's identity: the `where` clause is keyed to the caller's own JWT subject.
   */
  private async ownEmployeeId(client: TenantClient, actor: VoiceActor): Promise<string | null> {
    const me = await client.employee.findFirst({ where: { user: { keycloakSub: actor.userId } }, select: { id: true } })
    return me?.id ?? null
  }

  /**
   * [SZCZELNOŚĆ / scope tightness] `KTO_PRACUJE` must never show a PRACOWNIK data outside their own
   * record. Rather than re-deriving a scoping rule of our own, this defers ENTIRELY to the SAME
   * `isGlobal`/`managedUnitIds` primitives `GrafikService`/`LeaveService`/`EmployeesService` already
   * use for their own row-level RBAC:
   *
   *  - GLOBAL (HR/ADMIN) or a MANAGER of ≥1 unit → a roster query scoped the identical way
   *    `EmployeesService.list` scopes it (global: everyone; manager: their managed unit(s)), cross-
   *    checked against `GrafikService.listShifts`/`LeaveService.list` — which are ALREADY scoped
   *    the same way for those roles — so no query here can return a wider audience than the real
   *    services would.
   *  - Anyone else (plain PRACOWNIK) → NO roster query is issued at all. The answer is built solely
   *    from the caller's own employee id + the SAME `mine: true`-scoped leave/shift reads the other
   *    read intents use, so even a hypothetically-misbehaving mock/service could never surface a
   *    colleague through this path (see the "even if the underlying mocks hand back foreign data"
   *    test in `voice-command.service.spec.ts`, which asserts this defensively).
   */
  private async ktoPracuje(
    client: TenantClient,
    actor: VoiceActor,
    date: string,
  ): Promise<{ date: string; pracujacy: string[]; nieobecni: string[] } | { date: string; self: { working: boolean; onApprovedLeave: boolean } }> {
    const managed = await managedUnitIds(client, actor.userId)
    const privileged = isGlobal(actor.roles) || managed.length > 0

    if (!privileged) {
      const myId = await this.ownEmployeeId(client, actor)
      const shifts = (await this.grafik.listShifts(client, actor)) as Array<{ employeeId: string; date: unknown }>
      const working = myId != null && shifts.some((s) => s.employeeId === myId && toISODate(s.date) === date)
      const leaves = (await this.leave.list(client, actor, { mine: true, state: 'APPROVED' })) as Array<{ startDate: Date; endDate: Date }>
      const onApprovedLeave = leaves.some((l) => toISODate(l.startDate)! <= date && date <= toISODate(l.endDate)!)
      return { date, self: { working, onApprovedLeave } }
    }

    const scopeUnits = isGlobal(actor.roles) ? null : managed
    const roster = (await client.employee.findMany({
      where: scopeUnits ? { unitId: { in: scopeUnits } } : {},
      select: { id: true, firstName: true, lastName: true },
    })) as Array<{ id: string; firstName: string; lastName: string }>

    const shifts = (await this.grafik.listShifts(client, actor)) as Array<{ employeeId: string; date: unknown }>
    const workingIds = new Set(shifts.filter((s) => toISODate(s.date) === date).map((s) => s.employeeId))

    const leaves = (await this.leave.list(client, actor, { state: 'APPROVED' })) as Array<{ employeeId: string; startDate: Date; endDate: Date }>
    const absentIds = new Set(leaves.filter((l) => toISODate(l.startDate)! <= date && date <= toISODate(l.endDate)!).map((l) => l.employeeId))

    const name = (e: { firstName: string; lastName: string }): string => `${e.firstName} ${e.lastName}`
    return {
      date,
      pracujacy: roster.filter((e) => workingIds.has(e.id)).map(name),
      nieobecni: roster.filter((e) => absentIds.has(e.id)).map(name),
    }
  }
}
