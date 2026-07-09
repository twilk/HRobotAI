import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator'

/** "HH:mm" 24h local time — mirrors ShiftDemand/Shift.start/end in the tenant schema. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** ISO `YYYY-MM-DD` calendar date (Shift.date is `@db.Date`). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const SHIFT_SOURCES = ['AUTO', 'MANUAL'] as const

export class CreateShiftDto {
  @IsUUID() employeeId!: string
  @IsUUID() lokalizacjaId!: string
  @IsOptional() @IsUUID() demandId?: string
  @Matches(ISO_DATE, { message: 'date must be an ISO YYYY-MM-DD calendar date' }) date!: string
  @Matches(HHMM, { message: 'start must be HH:mm' }) start!: string
  @Matches(HHMM, { message: 'end must be HH:mm' }) end!: string
  @IsString() role!: string
  @IsOptional() @IsIn(SHIFT_SOURCES) source?: (typeof SHIFT_SOURCES)[number]
}

/** All fields optional — PATCH semantics; unset fields are left untouched. */
export class UpdateShiftDto {
  @IsOptional() @IsUUID() employeeId?: string
  @IsOptional() @IsUUID() lokalizacjaId?: string
  @IsOptional() @IsUUID() demandId?: string
  @IsOptional() @Matches(ISO_DATE, { message: 'date must be an ISO YYYY-MM-DD calendar date' }) date?: string
  @IsOptional() @Matches(HHMM, { message: 'start must be HH:mm' }) start?: string
  @IsOptional() @Matches(HHMM, { message: 'end must be HH:mm' }) end?: string
  @IsOptional() @IsString() role?: string
  @IsOptional() @IsIn(SHIFT_SOURCES) source?: (typeof SHIFT_SOURCES)[number]
}
