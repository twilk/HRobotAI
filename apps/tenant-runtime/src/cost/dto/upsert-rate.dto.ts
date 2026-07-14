import { IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator'
import { EmploymentType } from '@hrobot/shared'

/**
 * `PATCH /koszty/rates` body — HR/ADMIN only (Codex P1-1: this route's `@Roles` NEVER includes
 * MANAGER, unlike `PATCH /ai-grafik/config`). `position` is free text on `Employee.position`
 * (Codex P1-5); `CostService.upsertRate` normalizes it (trim + collapse whitespace) before the
 * `@@unique([position, employmentType])` write, so this DTO only guards against a blank string —
 * NOT against cosmetic whitespace variants of an existing position.
 */
export class UpsertRateDto {
  @IsString() @MinLength(1) position!: string

  /** Real Prisma enum (schema.prisma `EmploymentType`) — imported, never a string literal. */
  @IsEnum(EmploymentType) employmentType!: EmploymentType

  /** Standard hourly rate in `currency` money units. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) hourlyRate!: number

  /** Defaults to "PLN" (schema default) when omitted. */
  @IsOptional() @IsString() currency?: string
}
