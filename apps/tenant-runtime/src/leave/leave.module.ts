import { Module } from '@nestjs/common'
import { AiGrafikModule } from '../ai-grafik/ai-grafik.module.js'
import { LeaveController } from './leave.controller.js'
import { LeaveService } from './leave.service.js'

/**
 * Wnioski (leave-request) module (M2 core-modules). Imports {@link AiGrafikModule} to reach its
 * exported `ReplacementService` + `AiProposalService` — the approve path's auto-scan tie-in reuses
 * them to raise AI replacement proposals for shifts the approved leave now vacates. `AuditService`
 * is provided by the `@Global()` TenantRuntimeModule, so it is NOT re-provided here.
 */
@Module({
  imports: [AiGrafikModule],
  controllers: [LeaveController],
  providers: [LeaveService],
  // Exported so `agent-glosowy` (Agent Głosowy) can reuse the SAME leave-request service (K1/K2)
  // rather than reinventing the create/RBAC/PENDING/maker-checker logic.
  exports: [LeaveService],
})
export class LeaveModule {}
