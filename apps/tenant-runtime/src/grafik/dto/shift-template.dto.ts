import { IsArray, IsOptional, IsString } from 'class-validator'

export class CreateShiftTemplateDto {
  @IsString() lokalizacjaTyp!: string
  @IsString() nazwa!: string
  /** Days of week the template applies to (e.g. ["MON","TUE"]). */
  @IsOptional() @IsArray() @IsString({ each: true }) dni?: string[]
  /** Demand windows: [{ start, end, rola, liczba }]. Free-form JSON, shape mirrors ShiftDemand. */
  @IsArray() okna!: unknown[]
}

/** All fields optional — PATCH semantics. */
export class UpdateShiftTemplateDto {
  @IsOptional() @IsString() lokalizacjaTyp?: string
  @IsOptional() @IsString() nazwa?: string
  @IsOptional() @IsArray() @IsString({ each: true }) dni?: string[]
  @IsOptional() @IsArray() okna?: unknown[]
}
