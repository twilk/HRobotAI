import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common'
import { Observable, from, switchMap } from 'rxjs'
import type { Counter } from 'prom-client'
import { TenantPrismaManager } from '@hrobot/db'
import { TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { RedisService } from '../../common/redis/redis.service.js'

interface TenantCacheEntry { id: string; status: string }
interface RequestWithTenant {
  user: { iss: string; sub: string; hrobot_roles: string[] }
  tenantId: string
  tenantClient: unknown
}

/**
 * Resolves tenant context after Passport guards run (NestJS guard phase).
 *
 * NestJS execution order: guards (all) → interceptors → pipes → handler.
 * Accordingly: KeycloakJwtGuard → RbacGuard → this interceptor → handler.
 *
 * This ordering is intentionally safe: RbacGuard reads only `request.user.hrobot_roles`
 * (set by Passport during KeycloakJwtGuard), not anything this interceptor stamps.
 * Future guards MUST NOT depend on `request.tenantId` or `request.tenantClient` —
 * those are only available starting from the interceptor phase.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name)
  // P3-5: short TTL so a SUSPENDED tenant loses access within ~30s instead of 5min. The full
  // invalidation (Redis DEL + tenantManager.evict on a status-change signal) lands when tenant
  // suspension is wired in the control plane; until then this caps the stale-access window.
  private readonly CACHE_TTL = 30

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly redis: RedisService,
    private readonly tenantManager: TenantPrismaManager,
    @Inject('REDIS_FALLBACK_COUNTER') private readonly fallbackCounter: Counter,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.resolve(ctx)).pipe(switchMap(() => next.handle()))
  }

  private async resolve(ctx: ExecutionContext): Promise<void> {
    const request = ctx.switchToHttp().getRequest<RequestWithTenant>()
    const slug = this.extractSlug(request.user?.iss ?? '')
    if (!slug) throw new UnauthorizedException('Cannot resolve tenant from token')

    const entry = await this.lookupTenant(`tenant:slug:${slug}`, slug)

    if (entry.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException('Tenant account is not active')
    }

    request.tenantId = entry.id
    request.tenantClient = await this.tenantManager.getClient(entry.id)
  }

  private async lookupTenant(cacheKey: string, slug: string): Promise<TenantCacheEntry> {
    try {
      const cached = await this.redis.client.get(cacheKey)
      if (cached) return JSON.parse(cached) as TenantCacheEntry
    } catch (err) {
      this.logger.warn({ err }, 'Redis unavailable, falling back to DB for tenant resolution')
      this.fallbackCounter.inc()
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true, status: true },
    })
    if (!tenant) throw new UnauthorizedException(`Unknown tenant slug: ${slug}`)

    const entry: TenantCacheEntry = { id: tenant.id, status: tenant.status }
    try {
      await this.redis.client.setex(cacheKey, this.CACHE_TTL, JSON.stringify(entry))
    } catch { /* best-effort cache population */ }

    return entry
  }

  private extractSlug(iss: string): string {
    return /\/realms\/hrobot-(.+)$/.exec(iss)?.[1] ?? ''
  }
}
