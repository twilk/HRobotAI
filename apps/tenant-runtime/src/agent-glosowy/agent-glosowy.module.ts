import { Module } from '@nestjs/common'
import { LeaveModule } from '../leave/leave.module.js'
import { GrafikModule } from '../grafik/grafik.module.js'
import { ShiftSwapModule } from '../shift-swap/shift-swap.module.js'
import { ZastepstwaModule } from '../zastepstwa/zastepstwa.module.js'
import { AgentGlosowyController } from './agent-glosowy.controller.js'
import { VoiceCommandService } from './voice-command.service.js'

/**
 * `agent-glosowy` feature module (M3 module 3 — Agent Głosowy). Wires the text pipeline
 * (intent parsing + interpret/execute) over the EXISTING domain services, reused — not reinvented:
 *
 *  - imports {@link LeaveModule} to reach its exported `LeaveService` (K1 urlop / K2 L4 / ANULUJ_WNIOSEK
 *    → `POST /api/wnioski` + cancel), {@link GrafikModule} for its exported `GrafikService` (K3 mój
 *    grafik / KTO_PRACUJE / NASTEPNA_ZMIANA / MOJA_EWIDENCJA → schedule reads), and
 *    {@link ShiftSwapModule} for its exported `ShiftSwapService` (ZAMIANA_ZMIANY → give-away swap
 *    request), and {@link ZastepstwaModule} for its exported `ZastepstwaService` (ZNAJDZ_ZASTEPSTWO
 *    → start a replacement search). The agent calls them AS the request's actor, so all
 *    RBAC/scoping/maker-checker rules are enforced there — the agent adds no authority of its own,
 *    with ONE deliberate exception: `ZastepstwaService.rozpocznij` has NO internal role check (its
 *    controller-level `@Roles` gate is the only enforcement), so `VoiceCommandService` replicates
 *    that same MANAGER/HR/ADMIN_KLIENTA gate itself before calling it — see `KADROWY_ROLES` there.
 *  - `AuditService` + the `@TenantRoute()` guards/interceptors come from the `@Global()`
 *    TenantRuntimeModule, so they are NOT re-provided here.
 *
 * No STT here: audio→text is an out-of-process seam (`stt.port.ts`); the module is fully usable via
 * text without it.
 */
@Module({
  imports: [LeaveModule, GrafikModule, ShiftSwapModule, ZastepstwaModule],
  controllers: [AgentGlosowyController],
  providers: [VoiceCommandService],
})
export class AgentGlosowyModule {}
