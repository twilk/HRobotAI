import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Body for `POST /ai-grafik/proposals/for-shift/:shiftId` (manual "znajdź zastępstwo"): an optional
 * free-text `reason` explaining why the shift needs a replacement (stored on the proposal, no PII).
 * The shift itself is taken from the route param, not the body.
 */
export class CreateProposalDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string
}
