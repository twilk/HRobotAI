import { Module } from '@nestjs/common'
import { ShiftSwapModule } from '../shift-swap/shift-swap.module.js'
import { CostService } from '../cost/cost.service.js'
import { AiGrafikController } from './ai-grafik.controller.js'
import { AiConfigService } from './ai-config.service.js'
import { ReplacementService } from './replacement.service.js'
import { AiProposalService } from './ai-proposal.service.js'

/**
 * AI-scheduling ("Grafik AI") module (M2 §AI). Task 0.3 ships the per-unit config surface
 * (`AiConfigService` + `GET/PATCH /ai-grafik/config`). Imports {@link ShiftSwapModule} to reach its
 * exported `SWAP_FEASIBILITY_VALIDATOR` seam, which later AI phases (proposal generation) inject to
 * reject infeasible replacements. `AuditService` is provided by the `@Global()` TenantRuntimeModule,
 * so it is NOT re-provided here.
 *
 * SP4 step 4 (Δcost hook): `AiProposalService` needs `CostService` to price the top feasible
 * candidate against the vacated employee. Rather than importing `CostModule` here (which itself
 * needs `AiConfigService` — see that module's doc — and would create a module cycle), `CostService`
 * is provided directly in THIS module's own `providers`. `CostService` is stateless (every method
 * takes the tenant `client` as a parameter; it holds no per-request state), so this module and
 * `CostModule` each holding their own singleton instance is harmless — cheaper than resolving a
 * cycle with `forwardRef()`. `AiConfigService` is exported (in addition to the existing
 * `ReplacementService`/`AiProposalService`) so `CostModule` can import THIS module to reach it.
 */
@Module({
  imports: [ShiftSwapModule],
  controllers: [AiGrafikController],
  providers: [AiConfigService, ReplacementService, AiProposalService, CostService],
  exports: [ReplacementService, AiProposalService, AiConfigService],
})
export class AiGrafikModule {}
