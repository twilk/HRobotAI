import { Body, Controller, Delete, Get, Ip, Param, ParseUUIDPipe, Post, Query, UnauthorizedException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { CurrentTenantClient, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { UsersService, type UsersActor, type ReconcileResult } from './users.service.js'
import { InviteUserDto, RoleAssignmentDto } from './dto/user.dto.js'

/**
 * UŻYTKOWNICY — user invites + RBAC role management. ADMIN_KLIENTA-only for EVERY route:
 * `@TenantRoute(Role.ADMIN_KLIENTA)` applies `@Roles(Role.ADMIN_KLIENTA)` at the CLASS level (via
 * `applyDecorators`/`SetMetadata`, not the standalone `Roles` helper — which is typed as a plain
 * `MethodDecorator` and cannot itself be stacked on a class) so the 403 fires before any handler
 * body runs — and therefore before any Keycloak call — for this route AND any future addition,
 * without relying on each new method remembering its own `@Roles`. This is the "403 before any
 * Keycloak call" LOCKED DECISION made structurally hard to violate. Mirrors `OnboardingController`
 * (`@TenantRoute(Role.ADMIN_KLIENTA)`), the existing precedent for a whole-controller role gate.
 *
 * `UsersService` re-checks ADMIN_KLIENTA against the actor's REAL (DB) state on every privileged
 * call regardless — this controller's gate is the cheap JWT-claim check, not the only one.
 */
@Controller('uzytkownicy')
@TenantRoute(Role.ADMIN_KLIENTA)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  private actor(user: JwtPayload, ip: string): UsersActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  /**
   * Keycloak admin-API calls are realm-scoped (`hrobot-<slug>`); tenant-runtime serves every
   * tenant's realm from a single process, so the realm is derived from the caller's OWN verified
   * JWT `iss` — never from a client-supplied field. Mirrors the same extraction already done
   * independently in `KeycloakJwtStrategy.isTrustedIssuer`/`TenantContextInterceptor.extractSlug`;
   * `TenantContextInterceptor` runs before this controller and already proved `iss` well-formed
   * enough to resolve a tenant, so failure here would indicate an internal inconsistency rather
   * than a hostile token — surfaced as 401 defensively either way.
   */
  private realm(user: JwtPayload): string {
    const match = /\/realms\/(hrobot-[a-z0-9][a-z0-9-]{1,28}[a-z0-9])$/.exec(user.iss ?? '')
    if (!match) throw new UnauthorizedException('Cannot resolve tenant realm from token')
    return match[1]!
  }

  /** RODO-safe roster — projection enforced in UsersService.list (SAFE_USER_SELECT). */
  @Get()
  async list(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return this.users.list(client)
  }

  // RBAC + saga ordering fully enforced in UsersService.invite — see its doc for the exact
  // KC-create → DB-create(+compensate) → GRANT → best-effort-email sequence.
  @Post()
  async invite(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Body() dto: InviteUserDto,
  ): Promise<unknown> {
    return this.users.invite(client, this.actor(user, ip), this.realm(user), dto.email, dto.role, dto.unitId ?? null)
  }

  // GRANT ordering (UserRole first, then KC) + self-escalation guard: UsersService.assignRole.
  @Post(':userId/roles')
  async assignRole(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RoleAssignmentDto,
  ): Promise<void> {
    return this.users.assignRole(client, this.actor(user, ip), this.realm(user), userId, dto.role, dto.unitId ?? null)
  }

  // REVOKE ordering (KC first, then UserRole) + last-admin guard: UsersService.revokeRole.
  // `role`/`unitId` travel in the DELETE body (same DTO shape as assign) per the plan.
  @Delete(':userId/roles')
  async revokeRole(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RoleAssignmentDto,
  ): Promise<void> {
    return this.users.revokeRole(client, this.actor(user, ip), this.realm(user), userId, dto.role, dto.unitId ?? null)
  }

  // KC-first setEnabled(false) + last-admin guard: UsersService.deactivate.
  @Post(':userId/deactivate')
  async deactivate(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.users.deactivate(client, this.actor(user, ip), this.realm(user), userId)
  }

  /**
   * Diagnostic/repair endpoint: diffs KC realm-role mappings vs `UserRole` rows for the whole
   * tenant (or `?userId=`), reporting every drift. `?fix=true` additionally deletes dangling
   * 'db_only' rows (see `UsersService.reconcile` for why that's the ONLY safe auto-fix direction).
   * No job scheduling here — this is the callable entry point a future cron/ops task can drive.
   */
  @Post('reconcile')
  async reconcile(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Query('fix') fix?: string,
    @Query('userId') userId?: string,
  ): Promise<ReconcileResult> {
    return this.users.reconcile(client, this.actor(user, ip), this.realm(user), { fix: fix === 'true', userId })
  }
}
