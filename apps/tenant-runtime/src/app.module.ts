import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { CommonModule } from './common/common.module.js'
import { TenantRuntimeModule } from './tenant-runtime/tenant-runtime.module.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'
import { TenantsModule } from './tenants/tenants.module.js'
import { OutboxModule } from './outbox/outbox.module.js'
// N-1: ProvisioningModule is intentionally NOT imported here — see the note in main.ts.
// `src/provisioning/` is a leftover copy of control-plane's provisioning pipeline; registering it
// makes this app a second, claim-less consumer of the `tenant.provision` queue.
import { EmployeesModule } from './employees/employees.module.js'
import { OnboardingModule } from './onboarding/onboarding.module.js'
import { GrafikModule } from './grafik/grafik.module.js'
import { ShiftSwapModule } from './shift-swap/shift-swap.module.js'
import { AiGrafikModule } from './ai-grafik/ai-grafik.module.js'
import { CostModule } from './cost/cost.module.js'
import { LeaveModule } from './leave/leave.module.js'
import { DostepyModule } from './dostepy/dostepy.module.js'
import { UstawieniaModule } from './ustawienia/ustawienia.module.js'
import { UsersModule } from './users/users.module.js'
import { StrategicBrainModule } from './strategic-brain/strategic-brain.module.js'
import { DokumentyModule } from './dokumenty/dokumenty.module.js'
import { AgentGlosowyModule } from './agent-glosowy/agent-glosowy.module.js'
import { AnalitykModule } from './analityk/analityk.module.js'
import { RedisService } from './common/redis/redis.service.js'

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ['req.headers.authorization'],
        formatters: { level: (label: string) => ({ level: label }) },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    CommonModule,
    TenantRuntimeModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    OutboxModule,
    EmployeesModule,
    OnboardingModule,
    GrafikModule,
    ShiftSwapModule,
    AiGrafikModule,
    CostModule,
    LeaveModule,
    DostepyModule,
    UstawieniaModule,
    UsersModule,
    StrategicBrainModule,
    DokumentyModule,
    AgentGlosowyModule,
    AnalitykModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
