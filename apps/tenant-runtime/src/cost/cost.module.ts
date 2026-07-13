import { Module } from '@nestjs/common'
import { AiGrafikModule } from '../ai-grafik/ai-grafik.module.js'
import { CostController } from './cost.controller.js'
import { CostService } from './cost.service.js'

/**
 * Standard cost-rate catalog + weekly cost/budget status (SP4). Imports {@link AiGrafikModule} to
 * reach its exported `AiConfigService` — needed by `CostService.budgetStatus`'s effective-cap
 * fallback. This is one-directional: `AiGrafikModule` does NOT import this module back (its
 * `AiProposalService` Δcost hook gets its own `CostService` instance from `AiGrafikModule`'s own
 * `providers` — see that module's doc for why), so there is no cycle. `AuditService` is provided by
 * the `@Global()` TenantRuntimeModule, so it is NOT re-provided here.
 */
@Module({
  imports: [AiGrafikModule],
  controllers: [CostController],
  providers: [CostService],
  exports: [CostService],
})
export class CostModule {}
