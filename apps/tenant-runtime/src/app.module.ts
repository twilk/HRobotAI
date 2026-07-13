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
import { ProvisioningModule } from './provisioning/provisioning.module.js'
import { EmployeesModule } from './employees/employees.module.js'
import { OnboardingModule } from './onboarding/onboarding.module.js'
import { GrafikModule } from './grafik/grafik.module.js'
import { ShiftSwapModule } from './shift-swap/shift-swap.module.js'
import { AiGrafikModule } from './ai-grafik/ai-grafik.module.js'
import { LeaveModule } from './leave/leave.module.js'
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
    ProvisioningModule,
    EmployeesModule,
    OnboardingModule,
    GrafikModule,
    ShiftSwapModule,
    AiGrafikModule,
    LeaveModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
