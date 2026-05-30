import { Global, Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { TenantPrismaModule } from './tenant-prisma/tenant-prisma.module.js'
import { KeycloakJwtStrategy } from './keycloak/keycloak-jwt.strategy.js'
import { KeycloakJwtGuard } from './keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from './tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from './rbac/rbac.guard.js'
import { AuditService } from './audit/audit.service.js'
import { AuditInterceptor } from './audit/audit.interceptor.js'

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'keycloak-jwt' }),
    TenantPrismaModule,
  ],
  providers: [
    KeycloakJwtStrategy,
    KeycloakJwtGuard,
    TenantContextInterceptor,
    RbacGuard,
    AuditService,
    AuditInterceptor,
    makeCounterProvider({
      name: 'tenant_redis_fallback_total',
      help: 'Times Redis was unavailable and Postgres fallback was used for tenant resolution',
    }),
    {
      provide: 'REDIS_FALLBACK_COUNTER',
      useFactory: (counter: { inc(): void }) => counter,
      inject: ['PROM_METRIC_TENANT_REDIS_FALLBACK_TOTAL'],
    },
  ],
  exports: [
    KeycloakJwtGuard,
    TenantContextInterceptor,
    RbacGuard,
    AuditService,
    AuditInterceptor,
    TenantPrismaModule,
  ],
})
export class TenantRuntimeModule {}
