import { IsBoolean } from 'class-validator'

/**
 * Body for `POST /ai-grafik/proposals/:id/manager-decision`: the manager's verdict on a proposal
 * awaiting approval. `approve=true` triggers the transactional replacement commit; `false` rejects it.
 */
export class ManagerDecisionDto {
  @IsBoolean() approve!: boolean
}
