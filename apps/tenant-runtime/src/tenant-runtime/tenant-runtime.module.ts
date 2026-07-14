import { Global, Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { TenantPrismaModule } from './tenant-prisma/tenant-prisma.module.js'
import { KeycloakJwtStrategy } from './keycloak/keycloak-jwt.strategy.js'
import { KeycloakJwtGuard } from './keycloak/keycloak-jwt.guard.js'
import { KeycloakAdminService } from './keycloak/keycloak-admin.service.js'
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
    KeycloakAdminService,
    // FIX-C4-style token: KeycloakAdminService's admin-API calls are unit-tested against a
    // mocked FETCH (see keycloak-admin.service.spec.ts) — no live Keycloak needed.
    { provide: 'FETCH', useValue: fetch },
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
    KeycloakAdminService,
    TenantContextInterceptor,
    RbacGuard,
    AuditService,
    AuditInterceptor,
    TenantPrismaModule,
    // @TenantRoute() applies TenantContextInterceptor via @UseInterceptors(ClassRef), which
    // Nest re-instantiates in each host module's context (EmployeesModule, OnboardingModule).
    // That re-instantiation needs every interceptor dep resolvable there, so this token (and
    // the prom counter it wraps) must be exported from this @Global() module — otherwise the
    // app crashes at boot with "can't resolve REDIS_FALLBACK_COUNTER". Unit specs mock the
    // token, so only a real boot surfaces this.
    'REDIS_FALLBACK_COUNTER',
    'PROM_METRIC_TENANT_REDIS_FALLBACK_TOTAL',
  ],
})
export class TenantRuntimeModule {}
