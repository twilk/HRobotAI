import { IsEnum, IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { ProactivityLevel } from '../performance-config.service.js'

/**
 * PATCH /strategic-brain/config — per-unit (or tenant-default) scoring-config edit. Every field is
 * optional (partial upsert); `unitId` selects WHICH config to write (absent = the tenant-wide
 * default row, `unitId` null). The four weights are validated to sum to 1.00 in
 * {@link PerformanceConfigService.upsertConfig} (all-four-or-none), so they are NOT cross-validated
 * here — this DTO only bounds each field's individual range. Shape matches
 * `UpsertPerformanceConfigInput`; the global `ValidationPipe({ whitelist: true })` strips anything
 * not declared here, so every writable column MUST appear.
 */
export class UpdatePerformanceConfigDto {
  /** Target unit; absent = the tenant-wide default config row (`unitId` null). */
  @IsOptional() @IsUUID() unitId?: string

  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) weightPerformance?: number
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) weightTimeliness?: number
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) weightQuality?: number
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) weightDevelopment?: number

  @IsOptional() @IsInt() @Min(1) @Max(10_080) slaTargetMinutes?: number
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) defectThreshold?: number
  @IsOptional() @IsInt() @Min(0) @Max(3_650) confidenceMinDays?: number
  @IsOptional() @IsInt() @Min(1) @Max(365) windowDays?: number
  @IsOptional() @IsInt() @Min(1) @Max(100) minValidWindows?: number
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) minSlopeForGrowth?: number
  @IsOptional() @IsInt() @Min(1) @Max(1_000) minPeerGroupSize?: number

  /** Real Prisma enum `ProactivityLevel` — TYLKO_NA_ZADANIE | PROAKTYWNE_REKOMENDACJE | PROAKTYWNE_ALERTY. */
  @IsOptional() @IsEnum(ProactivityLevel) proactivityLevel?: ProactivityLevel
}
