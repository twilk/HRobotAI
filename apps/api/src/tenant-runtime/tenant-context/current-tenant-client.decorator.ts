import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'

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
