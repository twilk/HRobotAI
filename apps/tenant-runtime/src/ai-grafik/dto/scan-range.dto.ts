import { IsISO8601 } from 'class-validator'

/**
 * Body for `POST /ai-grafik/replacements/scan`: the closed `[from, to]` calendar-date window to
 * sweep for vacated shifts (a scheduled shift whose assigned employee has APPROVED leave covering
 * the shift's date). Both bounds are inclusive ISO `YYYY-MM-DD` dates matched against `Shift.date`
 * (a `@db.Date`). `strict: true` rejects calendar-impossible dates (e.g. `2026-13-45`, `2026-02-30`)
 * that a bare regex would let through into `new Date()` as `Invalid Date` (→ a Prisma 500). This
 * route only DETECTS collisions; it never creates proposals or mutates data.
 */
export class ScanRangeDto {
  @IsISO8601({ strict: true }, { message: 'from must be a valid ISO YYYY-MM-DD calendar date' }) from!: string
  @IsISO8601({ strict: true }, { message: 'to must be a valid ISO YYYY-MM-DD calendar date' }) to!: string
}
