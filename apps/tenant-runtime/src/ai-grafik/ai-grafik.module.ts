import { Module } from '@nestjs/common'
import { ShiftSwapModule } from '../shift-swap/shift-swap.module.js'
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
 */
@Module({
  imports: [ShiftSwapModule],
  controllers: [AiGrafikController],
  providers: [AiConfigService, ReplacementService, AiProposalService],
})
export class AiGrafikModule {}
