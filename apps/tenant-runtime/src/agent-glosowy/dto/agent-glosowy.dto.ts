import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
import type { AgentIntent } from '../intent.util.js'

/** The intents of the CLOSED command set (K1/K2/K3 + the out-of-set sentinel), grown incrementally. */
const AGENT_INTENTS: readonly AgentIntent[] = ['URLOP', 'L4', 'MOJ_GRAFIK', 'SALDO_URLOPU', 'STATUS_WNIOSKU', 'NIEZNANE']

/**
 * `POST /agent-glosowy/interpret` body. Text-only — audio→text (STT) is an out-of-process concern
 * (see {@link import('../stt.port.js').SttPort}); a keyboard user and a future STT adapter both feed
 * `text` here.
 */
export class InterpretDto {
  @IsString() @IsNotEmpty() text!: string
}

/** Slots echoed from an `interpret` response back into `execute` (dates ISO `YYYY-MM-DD`). */
export class AgentEntitiesDto {
  @IsOptional() @IsString() dateFrom?: string
  @IsOptional() @IsString() dateTo?: string
  @IsOptional() @IsString() type?: string
}

/**
 * `POST /agent-glosowy/execute` body. The client replays the `intent`/`entities` from a prior
 * `interpret` plus a `confirm` flag. For a WRITE intent (URLOP/L4) the service REQUIRES `confirm ===
 * true` (human-in-the-loop) — the gate is enforced in {@link VoiceCommandService.execute}, not here.
 */
export class ExecuteDto {
  @IsIn(AGENT_INTENTS) intent!: AgentIntent

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AgentEntitiesDto)
  entities?: AgentEntitiesDto

  @IsOptional() @IsBoolean() confirm?: boolean
}
