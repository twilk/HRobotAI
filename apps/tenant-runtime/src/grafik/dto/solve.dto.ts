import { ArrayNotEmpty, IsArray, IsOptional, IsUUID, Matches } from 'class-validator'

/** ISO `YYYY-MM-DD` calendar date — the Monday the horizon starts on (mirrors HorizonSchema.weekStart). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Body for `POST /grafik/solve`: the horizon + scope to hand to the optimizer.
 *
 *  - `weekStart` — Monday of the week being solved (ISO date). The horizon is the 7 days from it.
 *  - `unitId` — scopes the *employees* fed to the solver (`Employee.unitId`). A MANAGER may only pass a
 *    unit they manage; omitting it means "all units I manage" (MANAGER) / "all units" (HR/ADMIN).
 *  - `lokalizacjaIds` — scopes the *demands/locations*. Omitting it means every location with demand in
 *    the week.
 */
export class SolveGrafikDto {
  @Matches(ISO_DATE, { message: 'weekStart must be an ISO YYYY-MM-DD calendar date' }) weekStart!: string
  @IsOptional() @IsUUID() unitId?: string
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsUUID('all', { each: true }) lokalizacjaIds?: string[]
}
