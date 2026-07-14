-- strategic-brain (Task 1, greenfield): AI performance analysis + development trajectory +
-- recruitment recommendation data model. Spec:
-- docs/superpowers/specs/2026-07-14-ai-performance-trajectory-recruitment-SPEC.md (§3, authoritative
-- §14 reconciliation). Additive-only — new enums, new tables, new FKs to existing Employee. No
-- changes to existing objects.
--
-- --create-only, HAND-AUTHORED (no live/shadow DB reachable from this environment — the tenant
-- Postgres container has no host port published and DATABASE_URL is unset), mirroring the
-- Prisma-generated SQL shape used by every prior migration in this tenant schema
-- (see 20260713141706_ai_grafik/migration.sql for the closest precedent: nullable-unitId config
-- table + partial-unique default row). NOT applied to any live DB by this change.
--
-- DEPLOYMENT GATE (do NOT run here): after this migration is applied by hand to the live tenant
-- database, the new tables/types are owned by the applying (e.g. `postgres` superuser) role and
-- MUST be reassigned so the tenant's own DB role can write to them:
--   ALTER TABLE "work_order" OWNER TO hu_<tenant>;
--   ALTER TABLE "complaint" OWNER TO hu_<tenant>;
--   ALTER TABLE "employee_performance_snapshot" OWNER TO hu_<tenant>;
--   ALTER TABLE "recruitment_recommendation" OWNER TO hu_<tenant>;
--   ALTER TABLE "performance_config" OWNER TO hu_<tenant>;
-- (repeat the pattern used for prior strategic-brain-adjacent tables per
-- docs superpowers reference_hrobot_m2_deploy notes on raw-SQL migrations + ALTER OWNER.)

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComplaintSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecoScopeType" AS ENUM ('LOKALIZACJA', 'UNIT');

-- CreateEnum
CREATE TYPE "RecruitmentVerdict" AS ENUM ('WZNOW', 'WSTRZYMAJ', 'UTRZYMAJ');

-- CreateEnum
CREATE TYPE "ProactivityLevel" AS ENUM ('TYLKO_NA_ZADANIE', 'PROAKTYWNE_REKOMENDACJE', 'PROAKTYWNE_ALERTY');

-- CreateTable
CREATE TABLE "work_order" (
    "id" TEXT NOT NULL,
    "assigned_to_employee_id" TEXT NOT NULL,
    "assigned_by_operator_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "lokalizacja_id" TEXT,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint" (
    "id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "employee_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "ComplaintSeverity" NOT NULL DEFAULT 'MINOR',
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_performance_snapshot" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "throughput" INTEGER NOT NULL,
    "median_cycle_minutes" INTEGER,
    "sla_hit_rate" DECIMAL(65,30),
    "defect_rate" DECIMAL(65,30),
    "composite_score" DECIMAL(65,30),
    "development_slope" DECIMAL(65,30),
    "confidence" DECIMAL(65,30) NOT NULL,
    "peer_group_key" TEXT NOT NULL,
    "is_new_hire" BOOLEAN NOT NULL,
    "excluded_reason" TEXT,
    "algorithm_version" INTEGER NOT NULL DEFAULT 1,
    "config_hash" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_performance_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_recommendation" (
    "id" TEXT NOT NULL,
    "scope_type" "RecoScopeType" NOT NULL DEFAULT 'LOKALIZACJA',
    "scope_id" TEXT NOT NULL,
    "verdict" "RecruitmentVerdict" NOT NULL,
    "rationale" TEXT NOT NULL,
    "factors" JSONB NOT NULL,
    "replaces_recommendation_id" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_user_id" TEXT,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "recruitment_recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_config" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "weight_performance" DECIMAL(65,30) NOT NULL DEFAULT 0.30,
    "weight_timeliness" DECIMAL(65,30) NOT NULL DEFAULT 0.25,
    "weight_quality" DECIMAL(65,30) NOT NULL DEFAULT 0.25,
    "weight_development" DECIMAL(65,30) NOT NULL DEFAULT 0.20,
    "sla_target_minutes" INTEGER NOT NULL DEFAULT 120,
    "defect_threshold" DECIMAL(65,30) NOT NULL DEFAULT 0.10,
    "confidence_min_days" INTEGER NOT NULL DEFAULT 30,
    "window_days" INTEGER NOT NULL DEFAULT 14,
    "min_valid_windows" INTEGER NOT NULL DEFAULT 3,
    "min_slope_for_growth" DECIMAL(65,30) NOT NULL DEFAULT 0.5,
    "min_peer_group_size" INTEGER NOT NULL DEFAULT 5,
    "proactivity_level" "ProactivityLevel" NOT NULL DEFAULT 'PROAKTYWNE_REKOMENDACJE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_order_assigned_to_employee_id_idx" ON "work_order"("assigned_to_employee_id");

-- CreateIndex
CREATE INDEX "work_order_lokalizacja_id_idx" ON "work_order"("lokalizacja_id");

-- CreateIndex
CREATE INDEX "work_order_completed_at_idx" ON "work_order"("completed_at");

-- CreateIndex
CREATE INDEX "complaint_employee_id_idx" ON "complaint"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_performance_snapshot_employee_id_window_start_wi_key" ON "employee_performance_snapshot"("employee_id", "window_start", "window_end");

-- CreateIndex
CREATE INDEX "employee_performance_snapshot_employee_id_window_end_idx" ON "employee_performance_snapshot"("employee_id", "window_end");

-- CreateIndex
CREATE INDEX "recruitment_recommendation_scope_type_scope_id_computed_a_idx" ON "recruitment_recommendation"("scope_type", "scope_id", "computed_at");

-- CreateIndex
CREATE UNIQUE INDEX "performance_config_unit_id_key" ON "performance_config"("unit_id");

-- AddForeignKey
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_assigned_to_employee_id_fkey" FOREIGN KEY ("assigned_to_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_performance_snapshot" ADD CONSTRAINT "employee_performance_snapshot_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- [B1, spec §14] `PerformanceConfig` nullable-default uniqueness: Postgres allows multiple NULL
-- values through a plain `@@unique([unitId])` (NULL is never equal to NULL for uniqueness
-- purposes), so multiple unit-less "default" configs could otherwise coexist. Enforce at most one
-- default (unit_id IS NULL) row via a partial unique index — mirrors "ai_config_single_default" on
-- ai_scheduling_config (20260713141706_ai_grafik/migration.sql). The plain unique index above still
-- enforces one config per non-null unit_id.
CREATE UNIQUE INDEX "perf_config_default_unique" ON "performance_config"("unit_id") WHERE "unit_id" IS NULL;
