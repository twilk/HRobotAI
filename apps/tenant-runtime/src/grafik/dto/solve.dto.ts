import { ArrayNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator'
import { IsMonday, IsRealCalendarDate } from './grafik-validators.js'

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
  @IsRealCalendarDate({ message: 'weekStart must be an ISO YYYY-MM-DD calendar date' })
  @IsMonday({ message: 'weekStart must be a Monday — the horizon is the 7 days starting there' })
  weekStart!: string
  @IsOptional() @IsUUID() unitId?: string
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsUUID('all', { each: true }) lokalizacjaIds?: string[]
}
