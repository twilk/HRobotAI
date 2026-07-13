import { IsArray, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator'
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
