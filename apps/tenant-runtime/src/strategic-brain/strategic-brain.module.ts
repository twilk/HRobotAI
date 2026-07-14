import { Module } from '@nestjs/common'
import { StrategicBrainController } from './strategic-brain.controller.js'
import { SnapshotService } from './snapshot.service.js'
import { RecommendationService } from './recommendation.service.js'
import { CapacityGapService } from './capacity-gap.service.js'
import { PerformanceConfigService } from './performance-config.service.js'
import { StrategicBrainScheduler } from './strategic-brain.scheduler.js'

/**
 * `strategic-brain` feature module (spec §6, plan Task 9). Wires the HTTP surface
 * ({@link StrategicBrainController}) over the scoring services and registers the autonomous
 * {@link StrategicBrainScheduler}.
 *
 * No `imports`:
 *  - `TenantPrismaManager` (scheduler), `AuditService` + `RbacGuard` (controller/@TenantRoute) come
 *    from the `@Global()` `TenantRuntimeModule`; `ControlPlanePrismaService` (scheduler) from the
 *    `@Global()` `CommonModule` — all resolvable app-wide without a local import.
 *  - `ScheduleModule.forRoot()` is deliberately NOT registered here. It is already registered ONCE
 *    by `OutboxModule` (imported in `AppModule`), and `forRoot()` installs an app-wide
 *    `DiscoveryService`-based explorer that finds EVERY `@Cron` provider in the container — including
 *    {@link StrategicBrainScheduler} declared below. Re-registering it would stand up a SECOND
 *    scheduler orchestrator and fire every cron twice. One registration, discovered globally.
 */
@Module({
  controllers: [StrategicBrainController],
  providers: [
    SnapshotService,
    RecommendationService,
    CapacityGapService,
    PerformanceConfigService,
    StrategicBrainScheduler,
  ],
})
export class StrategicBrainModule {}
