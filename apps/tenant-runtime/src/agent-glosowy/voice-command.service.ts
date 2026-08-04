import { BadRequestException, Injectable } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { LeaveService } from '../leave/leave.service.js'
import { GrafikService } from '../grafik/grafik.service.js'
import type { CreateLeaveDto } from '../leave/dto/leave.dto.js'
import { drawsDownAnnualEntitlement } from '../common/leave-type.js'
import { parseIntent, CONFIDENCE_THRESHOLD, type AgentIntent, type ParsedEntities } from './intent.util.js'

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

export type ProposedActionKind = 'CREATE_LEAVE' | 'READ_SCHEDULE' | 'READ_LEAVE_BALANCE' | 'READ_LEAVE_STATUS' | 'NONE'

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

const WRITE_INTENTS: ReadonlySet<AgentIntent> = new Set<AgentIntent>(['URLOP', 'L4'])

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

    if (WRITE_INTENTS.has(intent)) {
      // [EU AI Act / RODO art. 22] hard human-in-the-loop gate: no confirmation → no write.
      if (confirm !== true) {
        throw new BadRequestException(
          'Potwierdzenie człowieka jest wymagane przed złożeniem wniosku (nadzór człowieka — EU AI Act / art. 22 RODO).',
        )
      }
      if (entities.dateFrom == null) {
        throw new BadRequestException('Brak daty początkowej — nie można złożyć wniosku.')
      }

      const type = entities.type ?? LEAVE_TYPE_BY_INTENT[intent as 'URLOP' | 'L4']
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
}
