import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator'
import { EmploymentType } from '@hrobot/shared'

/**
 * PATCH /employees/:id — HR/ADMIN-only edit. All fields optional (partial update); unset fields
 * are left untouched by the service. `pesel` is write-only: it is never returned and is encrypted
 * (via `@hrobot/db` `encryptEmployeePesel`) before it ever reaches the database or an audit entry.
 */
export class UpdateEmployeeDto {
  @IsOptional() @IsString() firstName?: string
  @IsOptional() @IsString() lastName?: string
  @IsOptional() @IsString() position?: string

  /** Real Prisma enum (schema.prisma `EmploymentType`) — UMOWA_O_PRACE | UMOWA_ZLECENIE | UMOWA_O_DZIELO | B2B. */
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType

  @IsOptional() @IsUUID() unitId?: string

  /**
   * Contract fraction (Employee.etat is a Prisma `Decimal`, arrives over the wire as a JSON number).
   * Seed convention (packages/db/src/seed/canonicalData.ts ETAT_CYCLE) is 0..1, where 1.0 = full-time.
   */
  @IsOptional() @IsNumber() @Min(0) @Max(1) etat?: number

  @IsOptional() @IsArray() @IsString({ each: true }) qualifications?: string[]

  /** Write-only PESEL (RODO PII) — encrypted via employeePii before persisting; never echoed back. */
  @IsOptional() @Matches(/^\d{11}$/, { message: 'pesel must be 11 digits' }) pesel?: string
}

/**
 * POST /employees — HR/ADMIN-only create (Task 4a). Required core fields mirror the Employee
 * schema's not-null-no-default columns (firstName/lastName/position/employmentType/unitId/pesel
 * /hiredAt — see schema.prisma). `hiredAt` is a real HR-meaningful date (when the person actually
 * started), not a technical timestamp, so it is a REQUIRED input rather than defaulted to "now" —
 * this lets HR backfill an employee who started before today. `pesel` is write-only: encrypted
 * (via `@hrobot/db` `encryptEmployeePesel`) before it ever reaches the database or an audit entry.
 * `etat`/`qualifications` are optional — the schema defaults them (1.0 / []) when omitted.
 */
export class CreateEmployeeDto {
  @IsString() firstName!: string
  @IsString() lastName!: string
  @IsString() position!: string

  /** Real Prisma enum (schema.prisma `EmploymentType`) — UMOWA_O_PRACE | UMOWA_ZLECENIE | UMOWA_O_DZIELO | B2B. */
  @IsEnum(EmploymentType) employmentType!: EmploymentType

  @IsUUID() unitId!: string

  /** RODO PII (11 digits) — encrypted via employeePii before persisting; never echoed back. */
  @Matches(/^\d{11}$/, { message: 'pesel must be 11 digits' }) pesel!: string

  /** ISO date string — when the employee actually started (schema `hiredAt`, required, no default). */
  @IsDateString() hiredAt!: string

  /**
   * Contract fraction (Employee.etat is a Prisma `Decimal`, arrives over the wire as a JSON number).
   * Seed convention (packages/db/src/seed/canonicalData.ts ETAT_CYCLE) is 0..1, where 1.0 = full-time.
   * Optional — schema defaults to 1.0 when omitted.
   */
  @IsOptional() @IsNumber() @Min(0) @Max(1) etat?: number

  @IsOptional() @IsArray() @IsString({ each: true }) qualifications?: string[]
}
