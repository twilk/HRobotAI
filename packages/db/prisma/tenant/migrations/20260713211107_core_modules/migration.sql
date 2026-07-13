-- Core modules foundation (Phase 0): Wnioski leave-decision columns, Ustawienia (CompanySettings
-- singleton), Dostępy (AccessGrant), Użytkownicy global-role idempotency. Additive-only — new enums,
-- new tables, new nullable columns/FKs on the existing LeaveRequest table. No changes to existing
-- objects other than the LeaveRequest.status default (APPROVED -> PENDING).

-- CreateEnum
CREATE TYPE "AccessType" AS ENUM ('CARD', 'KEY', 'PERMISSION');

-- CreateEnum
CREATE TYPE "AccessStatus" AS ENUM ('ACTIVE', 'REVOKED', 'LOST');

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "decided_by_user_id" TEXT,
ADD COLUMN     "reason" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Warsaw',
    "region" TEXT NOT NULL DEFAULT 'EU-Central',
    "locale" TEXT NOT NULL DEFAULT 'pl-PL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_grant" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "AccessType" NOT NULL,
    "label" TEXT NOT NULL,
    "identifier" TEXT,
    "lokalizacja_id" TEXT,
    "status" "AccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_by_user_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_grant_employee_id_idx" ON "access_grant"("employee_id");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_lokalizacja_id_fkey" FOREIGN KEY ("lokalizacja_id") REFERENCES "lokalizacje"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- [Codex P1 fix] Singleton enforcement for company_settings: Prisma has no native "singleton table"
-- construct, so a partial unique index on a constant expression enforces at most one row ever exists.
CREATE UNIQUE INDEX "company_settings_singleton" ON "company_settings" ((true));

-- [Codex P1 fix] At most one ACTIVE access grant per (type, identifier) pair. A plain @@unique would
-- either forbid legitimate identifier reuse after REVOKED/LOST, or (if omitted) allow two concurrently
-- ACTIVE grants sharing the same physical card/key. Partial unique index scopes the constraint to
-- ACTIVE + non-null identifier only.
CREATE UNIQUE INDEX "access_grant_active_identifier" ON "access_grant" ("type","identifier") WHERE "status" = 'ACTIVE' AND "identifier" IS NOT NULL;

-- [Codex P1 fix] `@@unique([userId, role, unitId])` on UserRole does not prevent multiple NULL-unitId
-- rows for the same (user, role) in Postgres (NULL is never equal to NULL for uniqueness purposes),
-- so a user could otherwise be granted the same *global* role redundantly. Enforce idempotency for
-- global (unit_id IS NULL) role grants via a partial unique index; the plain @@unique above still
-- enforces one grant per (user, role, non-null unit) tuple.
CREATE UNIQUE INDEX "user_role_global_uniq" ON "user_roles" ("user_id","role") WHERE "unit_id" IS NULL;
