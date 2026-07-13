import { IsEnum, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator'
import { AutonomyLevel } from '@hrobot/shared'

/**
 * PATCH /ai-grafik/config — AI-scheduling ("Grafik AI") per-unit config edit. Every field is
 * optional (partial upsert); an omitted field falls back to the schema default on create and is
 * left untouched on update. `unitId` selects WHICH unit's config to write — a `null`/absent unit is
 * the tenant-wide default row (schema `AiSchedulingConfig` `@@unique([unitId])`). Quiet-hours are
 * "HH:MM" 24h strings; `consentTtlHours` is bounded to a sane 1h–7d window.
 */
export class UpdateAiConfigDto {
  /** Real Prisma enum (schema.prisma `AutonomyLevel`) — SUGGEST_ONLY | AUTO_NOTIFY | AUTO_ASK_CONSENT | AUTO_COMMIT_ON_APPROVAL. */
  @IsOptional() @IsEnum(AutonomyLevel) autonomyLevel?: AutonomyLevel

  /** Target unit; absent = the tenant-wide default config row (`unitId` null). */
  @IsOptional() @IsUUID() unitId?: string

  /** Quiet-hours window start, "HH:MM" 24h. */
  @IsOptional() @Matches(/^\d{2}:\d{2}$/, { message: 'quietHoursStart must be HH:MM' }) quietHoursStart?: string

  /** Quiet-hours window end, "HH:MM" 24h. */
  @IsOptional() @Matches(/^\d{2}:\d{2}$/, { message: 'quietHoursEnd must be HH:MM' }) quietHoursEnd?: string

  /** Consent time-to-live in hours (1h .. 168h = 7 days). */
  @IsOptional() @IsInt() @Min(1) @Max(168) consentTtlHours?: number
}
