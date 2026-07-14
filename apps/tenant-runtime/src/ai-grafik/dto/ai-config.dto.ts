import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator'
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
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietHoursStart must be HH:MM' }) quietHoursStart?: string

  /** Quiet-hours window end, "HH:MM" 24h. */
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietHoursEnd must be HH:MM' }) quietHoursEnd?: string

  /** Consent time-to-live in hours (1h .. 168h = 7 days). */
  @IsOptional() @IsInt() @Min(1) @Max(168) consentTtlHours?: number

  /**
   * (Codex P1-2) Weekly budget cap in money units, matching `PositionCostRate.currency` (nullable
   * Decimal on the schema). Omit to leave untouched; a real number sets/replaces the cap. Money
   * arrives over the wire as a JSON number and is written into the Prisma `Decimal` column as-is —
   * mirrors the `etat` convention (employee.dto.ts).
   */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) budgetWeeklyCap?: number

  /**
   * Cross-unit replacement travel policy (2026-07-14 spec) — "szacunkowy dojazd (demo)". Every field
   * optional (partial upsert), same convention as the rest of this DTO.
   */
  /** Assumed average driving speed (km/h) used to derive travel minutes from haversine km. */
  @IsOptional() @IsInt() @Min(1) @Max(200) avgSpeedKmh?: number

  /** Per-km travel reimbursement rate ("kilometrówka"), PLN. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) perKmRatePln?: number

  /** H-TRAVEL hard feasibility ceiling, in minutes — a cross-unit candidate over this is infeasible. */
  @IsOptional() @IsInt() @Min(0) @Max(1440) maxTravelMinutes?: number

  /** Whether travel cost prices a there-and-back trip (×2) or the one-way leg only. */
  @IsOptional() @IsBoolean() roundTrip?: boolean
}
