import { Module } from '@nestjs/common'
import { LeaveModule } from '../leave/leave.module.js'
import { GrafikModule } from '../grafik/grafik.module.js'
import { AgentGlosowyController } from './agent-glosowy.controller.js'
import { VoiceCommandService } from './voice-command.service.js'

/**
 * `agent-glosowy` feature module (M3 module 3 — Agent Głosowy). Wires the text pipeline
 * (intent parsing + interpret/execute) over the EXISTING domain services, reused — not reinvented:
 *
 *  - imports {@link LeaveModule} to reach its exported `LeaveService` (K1 urlop / K2 L4 →
 *    `POST /api/wnioski`), and {@link GrafikModule} for its exported `GrafikService` (K3 mój grafik
 *    → schedule read). The agent calls them AS the request's actor, so all RBAC/scoping/maker-checker
 *    rules are enforced there — the agent adds no authority of its own.
 *  - `AuditService` + the `@TenantRoute()` guards/interceptors come from the `@Global()`
 *    TenantRuntimeModule, so they are NOT re-provided here.
 *
 * No STT here: audio→text is an out-of-process seam (`stt.port.ts`); the module is fully usable via
 * text without it.
 */
@Module({
  imports: [LeaveModule, GrafikModule],
  controllers: [AgentGlosowyController],
  providers: [VoiceCommandService],
})
export class AgentGlosowyModule {}
