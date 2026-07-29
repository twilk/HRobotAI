import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantClient, CurrentTenantId, CurrentUser } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'
import { isGlobal, managedUnitIds } from '../tenant-runtime/rbac/unit-scope.js'
import { DokumentyService, type DokumentyActor } from './dokumenty.service.js'
import { GenerujDokumentDto } from './dto/generuj-dokument.dto.js'

/** HR/ADMIN act across every unit; a MANAGER is unit-scoped (scope applied in the SERVICE, M16). */
const MANAGE_ROLES = [Role.HR, Role.ADMIN_KLIENTA, Role.MANAGER] as const
/** Read of a single doc / own ewidencja also open to a plain PRACOWNIK (self, resolved in service). */
const SELF_ROLES = [Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA, Role.PRACOWNIK] as const

/**
 * `dokumenty` HTTP surface (SPEC §5). A THIN controller mirroring `strategic-brain.controller.ts`:
 * `@TenantRoute()`'s RbacGuard checks the coarse `hrobot_roles`, then every read/write delegates to
 * {@link DokumentyService}. Two responsibilities live here by design:
 *
 *  - [M16] MANAGER unit-scope is SERVICE-LEVEL: the controller resolves the caller's scope
 *    ({@link resolveScope}: `null` for a GLOBAL HR/ADMIN, else their managed unit ids) and passes it
 *    into the service, which does the row-level filtering + `scopeType=ALL` GLOBAL-only enforcement.
 *  - Route ordering: the literal `mine` GET is declared BEFORE `:id` so Nest does not match
 *    `/dokumenty/mine` against the `:id` param route (ParseUUIDPipe would 400 on "mine").
 */
@Controller('dokumenty')
@TenantRoute()
export class DokumentyController {
  constructor(private readonly dokumenty: DokumentyService) {}

  private actor(user: JwtPayload, ip: string): DokumentyActor {
    return { userId: user.sub, roles: user.hrobot_roles ?? [], ipAddress: ip }
  }

  /** `null` ⇒ GLOBAL actor (HR/ADMIN, unscoped); else the caller's managed unit ids (MANAGER). */
  private async resolveScope(client: TenantClient, user: JwtPayload): Promise<string[] | null> {
    return isGlobal(user.hrobot_roles ?? []) ? null : managedUnitIds(client, user.sub)
  }

  // Metadata list (no content, no PESEL). MANAGER scoped to their units in the service.
  @Get()
  @Roles(...MANAGE_ROLES)
  async list(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown[]> {
    const scope = await this.resolveScope(client, user)
    return this.dokumenty.list(client, this.actor(user, ip), scope)
  }

  // Route ordering is load-bearing: this literal `mine` path MUST stay declared BEFORE `@Get(':id')`.
  // A plain PRACOWNIK reads their OWN ewidencja here (self via keycloakSub, resolved in the service).
  @Get('mine')
  @Roles(...SELF_ROLES)
  async mine(@CurrentTenantClient() client: TenantClient, @CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<unknown[]> {
    return this.dokumenty.mine(client, this.actor(user, ip))
  }

  // Generate a document (§5). Scope + scopeType=ALL rule enforced in the service.
  @Post('generuj')
  @Roles(...MANAGE_ROLES)
  async generuj(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: GenerujDokumentDto,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    return this.dokumenty.generuj(client, this.actor(user, ip), dto, scope, tenantId)
  }

  // Single-document metadata. PRACOWNIK allowed only for their OWN doc (checked in the service).
  @Get(':id')
  @Roles(...SELF_ROLES)
  async getOne(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    return this.dokumenty.getById(client, this.actor(user, ip), id, scope)
  }

  // Binary/text download with Content-Disposition. ZUS re-materializes via the audited decrypt path.
  @Get(':id/pobierz')
  @Roles(...SELF_ROLES)
  async pobierz(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Buffer | string> {
    const scope = await this.resolveScope(client, user)
    const out = await this.dokumenty.pobierz(client, this.actor(user, ip), id, scope, tenantId)
    res.setHeader('Content-Type', out.mime)
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`)
    return out.buffer ?? out.text ?? ''
  }

  // Human approval gate (§5, DOK-6, art. 22). NADGODZINY/ZUS GENERATED → APPROVED. Sends NOTHING.
  @Post(':id/zatwierdz')
  @Roles(...MANAGE_ROLES)
  async zatwierdz(
    @CurrentTenantClient() client: TenantClient,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    const scope = await this.resolveScope(client, user)
    return this.dokumenty.zatwierdz(client, this.actor(user, ip), id, scope)
  }
}
