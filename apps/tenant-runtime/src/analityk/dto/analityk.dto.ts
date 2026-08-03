import { IsOptional, IsString, IsUUID, Matches } from 'class-validator'

/**
 * Shared query for every `GET /analityk/*` endpoint: a closed, inclusive `[od, do]` date range plus
 * an optional unit narrowing.
 *
 * `od`/`do` are validated as strict `YYYY-MM-DD` here (shape) and re-parsed in
 * `analityk.range.ts#buildRange` (calendar validity + inversion), so a malformed range is a 400
 * before any query runs. `unitId` is INTERSECTED with the caller's RBAC scope in the service — a
 * MANAGER passing a unit they do not manage gets a 403, never another unit's data.
 */
export class AnalitykRangeQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Parametr "od" musi mieć format YYYY-MM-DD' })
  @IsString()
  od!: string

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Parametr "do" musi mieć format YYYY-MM-DD' })
  @IsString()
  do!: string

  /** Narrow to a single organizational unit; omitted = the caller's full scope. */
  @IsOptional()
  @IsUUID()
  unitId?: string
}
