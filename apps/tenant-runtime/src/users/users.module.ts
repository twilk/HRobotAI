import { Module } from '@nestjs/common'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'

/**
 * UŻYTKOWNICY module (M2) — user invites + RBAC role management, the highest-risk dual-write
 * surface in M2 (Keycloak realm roles ↔ tenant `UserRole`). `KeycloakAdminService` and
 * `AuditService` are provided by the `@Global()` TenantRuntimeModule, so they are NOT re-provided
 * here (matches `DostepyModule`/`UstawieniaModule`).
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
