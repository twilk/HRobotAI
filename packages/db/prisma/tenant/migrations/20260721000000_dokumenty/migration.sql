-- Moduł Dokumenty (M3, greenfield): RCP time-tracking events + generated HR/payroll documents
-- (ewidencja czasu pracy / nadgodziny / ZUS-KEDU export skeleton). Spec:
-- docs/superpowers/specs/2026-07-21-modul-dokumenty-SPEC.md (§2, authoritative data model).
-- Additive-only — new enums, new tables, new FKs to existing Employee/Lokalizacja. No changes to
-- existing objects.
--
-- --create-only, HAND-AUTHORED (no live/shadow DB reachable from this environment — DATABASE_URL is
-- unset and `prisma migrate dev --create-only` fails with P1012), mirroring the Prisma-generated SQL
-- shape used by every prior migration in this tenant schema (see
-- 20260714000000_strategic_brain/migration.sql for the closest precedent: create-only hand-authored
-- style, partial-unique index appended by hand, ALTER OWNER deployment-gate comment). NOT applied to
-- any live DB by this change.
--
-- DEPLOYMENT GATE (do NOT run here): after this migration is applied by hand to the live tenant
-- database, the new tables are owned by the applying (e.g. `postgres` superuser) role and MUST be
-- reassigned so the tenant's own DB role can write to them:
--   ALTER TABLE "rcp_event"          OWNER TO hu_<tenant>;
--   ALTER TABLE "generated_document" OWNER TO hu_<tenant>;
-- (wzór reference_hrobot_m2_deploy: raw-SQL migrations + ALTER OWNER; żywy tenant hu_900d948b.)

-- CreateEnum
CREATE TYPE "RcpEventType" AS ENUM ('WEJSCIE', 'WYJSCIE', 'PRZERWA_START', 'PRZERWA_KONIEC');

-- CreateEnum
CREATE TYPE "RcpEventSource" AS ENUM ('KONTROLA_DOSTEPU', 'PANEL_WEB', 'MOBILE', 'IMPORT', 'KOREKTA');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('EWIDENCJA_CZASU_PRACY', 'NADGODZINY', 'ZUS_KEDU');

-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('PDF', 'XML_KEDU');

-- CreateEnum
-- NOTE (DOK-10): deliberately only 3 members — no SENT/EXPORTED_EXTERNAL. No document produced by
-- this module ever leaves the tenant via this status; there is no "external send" state or path.
CREATE TYPE "DocumentStatus" AS ENUM ('GENERATED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocScopeType" AS ENUM ('EMPLOYEE', 'UNIT', 'ALL');

-- CreateTable
CREATE TABLE "rcp_event" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "type" "RcpEventType" NOT NULL,
    "source" "RcpEventSource" NOT NULL DEFAULT 'PANEL_WEB',
    "lokalizacja_id" TEXT,
    "corrects_event_id" TEXT,
    "entered_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rcp_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_document" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "format" "DocumentFormat" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'GENERATED',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "scope_type" "DocScopeType" NOT NULL,
    "employee_id" TEXT,
    "unit_id" TEXT,
    "content_text" TEXT,
    "content_bytes" BYTEA,
    "content_path" TEXT,
    "content_hash" TEXT NOT NULL,
    "computed_facts" JSONB NOT NULL,
    "algorithm_version" INTEGER NOT NULL DEFAULT 1,
    "replaces_document_id" TEXT,
    "generated_by_user_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "retention_until" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rcp_event_employee_id_occurred_at_idx" ON "rcp_event"("employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "rcp_event_lokalizacja_id_idx" ON "rcp_event"("lokalizacja_id");

-- CreateIndex
CREATE INDEX "generated_document_type_period_start_period_end_idx" ON "generated_document"("type", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "generated_document_employee_id_idx" ON "generated_document"("employee_id");

-- CreateIndex
CREATE INDEX "generated_document_unit_id_idx" ON "generated_document"("unit_id");

-- AddForeignKey
ALTER TABLE "rcp_event" ADD CONSTRAINT "rcp_event_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rcp_event" ADD CONSTRAINT "rcp_event_lokalizacja_id_fkey" FOREIGN KEY ("lokalizacja_id") REFERENCES "lokalizacje"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_document" ADD CONSTRAINT "generated_document_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- [spec §2.2] Idempotent import/seed dedup: `(employeeId, occurredAt, type)` is not a safe natural
-- key for manual sources (KOREKTA deliberately reuses a timestamp), so uniqueness is scoped to
-- deterministic IMPORT-sourced events only via a partial unique index — mirrors
-- "perf_config_default_unique" on performance_config (20260714000000_strategic_brain/migration.sql)
-- and "ai_config_single_default" on ai_scheduling_config (20260713141706_ai_grafik/migration.sql).
-- Seed scripts (scripts/seed-demo-dokumenty.sql) rely on this via INSERT ... ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX "rcp_event_dedup_import" ON "rcp_event"("employee_id","occurred_at","type") WHERE "source" IN ('IMPORT');
