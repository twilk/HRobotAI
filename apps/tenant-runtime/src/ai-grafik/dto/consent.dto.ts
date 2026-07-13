import { IsBoolean } from 'class-validator'

/**
 * Body for `POST /ai-grafik/proposals/:id/consent`: the asked employee's answer to their consent
 * request. `accept=true` grants consent (advances to manager review); `false` declines (promotes the
 * next candidate or escalates). The service enforces that the caller IS the asked candidate.
 */
export class ConsentDto {
  @IsBoolean() accept!: boolean
}
