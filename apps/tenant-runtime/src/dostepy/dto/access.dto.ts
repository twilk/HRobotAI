import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'
import { AccessType } from '@hrobot/shared'

/**
 * POST /dostepy — issue a physical/logical access grant (Dostęp) to an employee: a card, key, or a
 * standalone permission. `identifier` (e.g. a card/key serial) is PII/security-sensitive — it is
 * stored but NEVER written to the append-only audit log. `lokalizacjaId` optionally ties the grant to
 * a location. At most one ACTIVE grant may exist per (type, identifier) pair (DB partial-unique);
 * a re-issue while the prior grant is still ACTIVE surfaces as a 409.
 */
export class IssueAccessDto {
  @IsUUID() employeeId!: string

  /** Real Prisma enum (schema.prisma `AccessType`) — CARD | KEY | PERMISSION. */
  @IsEnum(AccessType) type!: AccessType

  @IsString() @IsNotEmpty() label!: string

  /** Card/key serial (security-sensitive) — persisted, but never echoed into audit payloads. */
  @IsOptional() @IsString() identifier?: string

  @IsOptional() @IsUUID() lokalizacjaId?: string

  @IsOptional() @IsString() notes?: string
}

/**
 * POST /dostepy/:id/revoke — revoke an ACTIVE grant. `reason` is an optional free-text note appended
 * to the grant's `notes` (no PII expected). The revoke is optimistic-locked on `status: ACTIVE`.
 */
export class RevokeDto {
  @IsOptional() @IsString() reason?: string
}
