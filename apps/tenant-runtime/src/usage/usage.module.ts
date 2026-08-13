import { Module } from '@nestjs/common'
import { UsageSnapshotScheduler } from './usage-snapshot.scheduler.js'

/**
 * Usage metering. One provider, no HTTP surface: this module exists to produce a number, not to
 * serve one. Reading it is a control-plane concern (and today, a SQL query) — deliberately not an
 * endpoint, because an endpoint would invite a dashboard and this is not a dashboard.
 *
 * No `imports`: `ControlPlanePrismaService` comes from the `@Global()` `CommonModule` and
 * `TenantPrismaManager` from the `@Global()` `TenantRuntimeModule`.
 *
 * `ScheduleModule.forRoot()` is deliberately NOT registered here — `OutboxModule` already registers
 * it once, and its discovery explorer finds every `@Cron` provider in the container. Registering it
 * again would stand up a second orchestrator and fire every cron in the app twice. Same reasoning is
 * documented on `StrategicBrainModule`.
 */
@Module({
  providers: [UsageSnapshotScheduler],
})
export class UsageModule {}
