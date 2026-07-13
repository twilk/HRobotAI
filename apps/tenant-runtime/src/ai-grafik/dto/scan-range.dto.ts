import { Matches } from 'class-validator'

/** ISO `YYYY-MM-DD` calendar date (mirrors SolveGrafikDto.weekStart). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Body for `POST /ai-grafik/replacements/scan`: the closed `[from, to]` calendar-date window to
 * sweep for vacated shifts (a scheduled shift whose assigned employee has APPROVED leave covering
 * the shift's date). Both bounds are inclusive ISO `YYYY-MM-DD` dates matched against `Shift.date`
 * (a `@db.Date`). This route only DETECTS collisions; it never creates proposals or mutates data.
 */
export class ScanRangeDto {
  @Matches(ISO_DATE, { message: 'from must be an ISO YYYY-MM-DD calendar date' }) from!: string
  @Matches(ISO_DATE, { message: 'to must be an ISO YYYY-MM-DD calendar date' }) to!: string
}
