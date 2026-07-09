import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parity with the Prisma `DemandSource` enum. */
const DEMAND_SOURCES = ['TEMPLATE', 'MANUAL'] as const

export class CreateShiftDemandDto {
  @IsUUID() lokalizacjaId!: string
  @Matches(ISO_DATE, { message: 'date must be an ISO YYYY-MM-DD calendar date' }) date!: string
  @Matches(HHMM, { message: 'start must be HH:mm' }) start!: string
  @Matches(HHMM, { message: 'end must be HH:mm' }) end!: string
  @IsString() requiredRole!: string
  @IsInt() @Min(1) requiredCount!: number
  @IsOptional() @IsIn(DEMAND_SOURCES) source?: (typeof DEMAND_SOURCES)[number]
}

/** All fields optional — PATCH semantics. */
export class UpdateShiftDemandDto {
  @IsOptional() @IsUUID() lokalizacjaId?: string
  @IsOptional() @Matches(ISO_DATE, { message: 'date must be an ISO YYYY-MM-DD calendar date' }) date?: string
  @IsOptional() @Matches(HHMM, { message: 'start must be HH:mm' }) start?: string
  @IsOptional() @Matches(HHMM, { message: 'end must be HH:mm' }) end?: string
  @IsOptional() @IsString() requiredRole?: string
  @IsOptional() @IsInt() @Min(1) requiredCount?: number
  @IsOptional() @IsIn(DEMAND_SOURCES) source?: (typeof DEMAND_SOURCES)[number]
}
