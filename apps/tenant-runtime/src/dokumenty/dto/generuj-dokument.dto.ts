import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator'
import { DocScopeType, DocumentFormat, DocumentType } from '../dokumenty.enums.js'

/**
 * POST /dokumenty/generuj body (SPEC §5). Mirrors `strategic-brain/dto/performance-config.dto.ts`:
 * class-validator field bounds + the global `ValidationPipe({ whitelist: true })` strips anything
 * not declared here, so every field the service reads MUST appear.
 *
 * Cross-field rules that a single `@IsX` cannot express live in two object-level constraints
 * ({@link PeriodOrderConstraint}, {@link ScopeConsistencyConstraint}), applied via `@Validate` and
 * receiving the whole DTO through `ValidationArguments.object` — the class-validator idiom for
 * "these fields must agree". Field-level `@IsEnum`/`@IsUUID`/`@IsDateString` handle the rest; any
 * failure surfaces as a 400 (SPEC §5).
 */

/** `periodStart <= periodEnd` (calendar dates). */
@ValidatorConstraint({ name: 'dokPeriodOrder', async: false })
export class PeriodOrderConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as GenerujDokumentDto
    if (!o.periodStart || !o.periodEnd) return false
    return new Date(o.periodStart).getTime() <= new Date(o.periodEnd).getTime()
  }
  defaultMessage(): string {
    return 'periodStart must be on or before periodEnd'
  }
}

/**
 * scope ↔ fields consistency (SPEC §5): EMPLOYEE ⇒ only `employeeId`; UNIT ⇒ only `unitId`;
 * ALL ⇒ both empty. Prevents e.g. an EMPLOYEE request that silently carries a `unitId`.
 */
@ValidatorConstraint({ name: 'dokScopeConsistency', async: false })
export class ScopeConsistencyConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as GenerujDokumentDto
    switch (o.scopeType) {
      case DocScopeType.EMPLOYEE:
        return Boolean(o.employeeId) && !o.unitId
      case DocScopeType.UNIT:
        return Boolean(o.unitId) && !o.employeeId
      case DocScopeType.ALL:
        return !o.employeeId && !o.unitId
      default:
        return false
    }
  }
  defaultMessage(): string {
    return 'scopeType must match its identifiers: EMPLOYEE⇒employeeId only, UNIT⇒unitId only, ALL⇒neither'
  }
}

export class GenerujDokumentDto {
  @IsEnum(DocumentType) type!: DocumentType

  @IsEnum(DocumentFormat) format!: DocumentFormat

  @IsEnum(DocScopeType)
  @Validate(ScopeConsistencyConstraint)
  scopeType!: DocScopeType

  /** Calendar date `YYYY-MM-DD` (or full ISO). @db.Date period boundary. */
  @IsDateString() periodStart!: string

  @IsDateString()
  @Validate(PeriodOrderConstraint)
  periodEnd!: string

  @IsOptional() @IsUUID() employeeId?: string

  @IsOptional() @IsUUID() unitId?: string
}
