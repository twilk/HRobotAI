import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common'
import { Role } from '@hrobot/shared'
import { KeycloakJwtGuard } from './keycloak/keycloak-jwt.guard.js'
import { RbacGuard } from './rbac/rbac.guard.js'
import { TenantContextInterceptor } from './tenant-context/tenant-context.interceptor.js'
import { AuditInterceptor } from './audit/audit.interceptor.js'
import { Roles } from './rbac/roles.decorator.js'

/**
 * P3-7: composes the full tenant-scoped request pipeline so a controller can't forget a piece.
 *
 *   KeycloakJwtGuard + RbacGuard            (guard phase — verify token, check @Roles)
 *   TenantContextInterceptor + AuditInterceptor (interceptor phase — bind tenant client, audit mutations)
 *
 * Forgetting the interceptor used to make @CurrentTenantClient() return undefined (runtime crash);
 * forgetting RbacGuard made @Roles a silent no-op (security hole). Bundling them removes both
 * footguns and guarantees mutating routes are always audited (AuditInterceptor no-ops on GETs).
 *
 * Ordering: TenantContextInterceptor precedes AuditInterceptor so the audit's post-handler tap
 * can read the request-bound tenant client.
 *
 * @example
 *   @Controller('employees') @TenantRoute() ...
 *   @Controller('tenants/me') @TenantRoute(Role.ADMIN_KLIENTA) ...
 */
export const TenantRoute = (
  ...roles: Array<(typeof Role)[keyof typeof Role]>
): ReturnType<typeof applyDecorators> =>
  applyDecorators(
    UseGuards(KeycloakJwtGuard, RbacGuard),
    UseInterceptors(TenantContextInterceptor, AuditInterceptor),
    ...(roles.length > 0 ? [Roles(...roles)] : []),
  )
