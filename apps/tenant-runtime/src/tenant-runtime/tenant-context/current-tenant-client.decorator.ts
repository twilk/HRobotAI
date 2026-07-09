import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import type { JwtPayload } from '../keycloak/keycloak-jwt.strategy.js'

/**
 * Injects the verified Keycloak JWT payload (`request.user`) set by Passport during
 * KeycloakJwtGuard. Handlers use `sub` (Keycloak subject → tenant `User.keycloakSub`) and
 * `hrobot_roles` for row-level RBAC scoping the RbacGuard can't express (e.g. a MANAGER
 * restricted to their own unit).
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest<{ user: JwtPayload }>().user,
)

/** Injects the per-request tenant PrismaClient stamped by TenantContextInterceptor. */
export const CurrentTenantClient = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantClient =>
    ctx.switchToHttp().getRequest<Record<string, unknown>>()['tenantClient'] as TenantClient,
)

/** Injects the tenantId string stamped by TenantContextInterceptor. */
export const CurrentTenantId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<Record<string, unknown>>()['tenantId'] as string,
)
