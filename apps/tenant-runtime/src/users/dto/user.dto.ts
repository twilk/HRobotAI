import { IsEmail, IsEnum, IsOptional, IsUUID, registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator'
import { Role } from '@hrobot/shared'

/**
 * FIX 2(a) defense-in-depth: ADMIN_KLIENTA is always GLOBAL — reject a DTO that pairs it with a
 * `unitId`. This is a SECONDARY guard purely for early/cheap 400s at the edge; the authoritative
 * enforcement is `UsersService`'s own `assertGlobalAdminGrant` check (see `invite`/`assignRole`),
 * which is what actually protects the dual-write — never trust this decorator alone.
 */
function IsGlobalAdminUnit(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isGlobalAdminUnit',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as { role?: Role }
          if (obj.role === Role.ADMIN_KLIENTA) return value === undefined || value === null
          return true
        },
        defaultMessage(): string {
          return 'ADMIN_KLIENTA jest zawsze globalny — bez jednostki'
        },
      },
    })
  }
}

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

  @IsOptional() @IsUUID() @IsGlobalAdminUnit() unitId?: string
}

/**
 * POST /uzytkownicy/:userId/roles and DELETE /uzytkownicy/:userId/roles (as the DELETE body) — grant
 * or revoke `role`, optionally scoped to `unitId` (omit/`null` for a GLOBAL grant/revoke). Shared
 * between assign and revoke since both dual-write flows key off the exact same (role, unitId) pair.
 */
export class RoleAssignmentDto {
  @IsEnum(Role) role!: Role

  @IsOptional() @IsUUID() @IsGlobalAdminUnit() unitId?: string
}
