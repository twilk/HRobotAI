import { IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator'
import { Role } from '@hrobot/shared'

/**
 * POST /uzytkownicy — ADMIN_KLIENTA-only invite. `role` is the INITIAL role granted as part of the
 * invite saga (see `UsersService.invite`); `unitId` scopes that initial grant (omit/`null` for a
 * GLOBAL grant). The 403-before-any-Keycloak-call gate lives in the controller's `@Roles` +
 * `UsersService.invite`'s own re-check — never trust this DTO's shape as authorization.
 */
export class InviteUserDto {
  @IsEmail() email!: string

  /** Real Prisma enum (schema.prisma tenant `Role`) — PRACOWNIK | MANAGER | HR | ADMIN_KLIENTA. */
  @IsEnum(Role) role!: Role

  @IsOptional() @IsUUID() unitId?: string
}

/**
 * POST /uzytkownicy/:userId/roles and DELETE /uzytkownicy/:userId/roles (as the DELETE body) — grant
 * or revoke `role`, optionally scoped to `unitId` (omit/`null` for a GLOBAL grant/revoke). Shared
 * between assign and revoke since both dual-write flows key off the exact same (role, unitId) pair.
 */
export class RoleAssignmentDto {
  @IsEnum(Role) role!: Role

  @IsOptional() @IsUUID() unitId?: string
}
