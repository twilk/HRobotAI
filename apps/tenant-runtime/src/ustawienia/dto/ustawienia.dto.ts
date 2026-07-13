import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'

/**
 * PATCH /ustawienia/company — the tenant-wide company settings edit (ADMIN_KLIENTA only). Every field
 * is optional (partial upsert of the singleton `CompanySettings` row); an omitted field is left
 * untouched on update and falls back to the schema default on the first create. `companyName`, when
 * present, must be a non-empty string.
 */
export class UpdateCompanyDto {
  /** Display name of the tenant company; non-empty when provided. */
  @IsOptional() @IsString() @IsNotEmpty() companyName?: string

  /** IANA timezone id, e.g. "Europe/Warsaw". */
  @IsOptional() @IsString() timezone?: string

  /** Coarse deployment region tag, e.g. "EU-Central". */
  @IsOptional() @IsString() region?: string

  /** BCP-47 locale, e.g. "pl-PL". */
  @IsOptional() @IsString() locale?: string
}

/** POST /ustawienia/units — create an organizational unit (ADMIN_KLIENTA only). */
export class CreateUnitDto {
  /** Unit display name; required and non-empty. */
  @IsString() @IsNotEmpty() name!: string

  /** Optional parent unit id (a root unit has no parent). */
  @IsOptional() @IsUUID() parentId?: string
}

/**
 * PATCH /ustawienia/units/:id — rename / reparent / assign-manager an org unit (ADMIN_KLIENTA only).
 * Every field is optional; `parentId` triggers the cycle-guarded, transactional reparent path in the
 * service; `managerUserId` is a `User.id` (a bad id trips the FK → 400).
 */
export class UpdateUnitDto {
  /** New unit name. */
  @IsOptional() @IsString() @IsNotEmpty() name?: string

  /** New parent unit id (reparent). Rejected if it would create a cycle. */
  @IsOptional() @IsUUID() parentId?: string

  /** `User.id` of the manager to assign to this unit. */
  @IsOptional() @IsUUID() managerUserId?: string
}
