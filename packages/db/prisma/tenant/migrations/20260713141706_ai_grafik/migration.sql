-- AI Grafik Manager (Task 0.1): config, proposal, candidate. Additive-only — new enums, new tables,
-- new FKs to existing Shift/Employee/OrganizationalUnit. No changes to existing objects.

-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('SUGGEST_ONLY', 'AUTO_NOTIFY', 'AUTO_ASK_CONSENT', 'AUTO_COMMIT_ON_APPROVAL');

-- CreateEnum
CREATE TYPE "AiProposalType" AS ENUM ('REPLACEMENT', 'ADHOC', 'CAPACITY');

-- CreateEnum
CREATE TYPE "AiProposalState" AS ENUM ('DRAFT', 'PENDING_EMPLOYEE_CONSENT', 'EMPLOYEE_AGREED', 'PENDING_MANAGER', 'APPROVED', 'REJECTED', 'ESCALATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConsentState" AS ENUM ('NOT_ASKED', 'PENDING', 'GRANTED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ai_scheduling_config" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "autonomy_level" "AutonomyLevel" NOT NULL DEFAULT 'SUGGEST_ONLY',
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "consent_ttl_hours" INTEGER NOT NULL DEFAULT 24,
    "budget_weekly_cap" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_scheduling_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposal" (
    "id" TEXT NOT NULL,
    "type" "AiProposalType" NOT NULL DEFAULT 'REPLACEMENT',
    "state" "AiProposalState" NOT NULL DEFAULT 'DRAFT',
    "shift_id" TEXT NOT NULL,
    "vacated_employee_id" TEXT NOT NULL,
    "active_candidate_id" TEXT,
    "reason" TEXT,
    "estimated_cost" DECIMAL(65,30),
    "decided_by_manager_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposal_candidate" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "feasible" BOOLEAN NOT NULL,
    "reason" TEXT,
    "score" DECIMAL(65,30),
    "consent_state" "ConsentState" NOT NULL DEFAULT 'NOT_ASKED',
    "consent_requested_at" TIMESTAMP(3),
    "consent_at" TIMESTAMP(3),

    CONSTRAINT "ai_proposal_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_scheduling_config_unit_id_key" ON "ai_scheduling_config"("unit_id");

-- CreateIndex
CREATE INDEX "ai_proposal_state_idx" ON "ai_proposal"("state");

-- CreateIndex
CREATE INDEX "ai_proposal_shift_id_idx" ON "ai_proposal"("shift_id");

-- CreateIndex
CREATE INDEX "ai_proposal_candidate_proposal_id_rank_idx" ON "ai_proposal_candidate"("proposal_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ai_proposal_candidate_proposal_id_employee_id_key" ON "ai_proposal_candidate"("proposal_id", "employee_id");

-- AddForeignKey
ALTER TABLE "ai_scheduling_config" ADD CONSTRAINT "ai_scheduling_config_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "organizational_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposal" ADD CONSTRAINT "ai_proposal_vacated_employee_id_fkey" FOREIGN KEY ("vacated_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposal_candidate" ADD CONSTRAINT "ai_proposal_candidate_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ai_proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposal_candidate" ADD CONSTRAINT "ai_proposal_candidate_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- [Codex P1 fix] `@@unique([unitId])` on a nullable column does not prevent multiple NULL rows in
-- Postgres (NULL is never equal to NULL for uniqueness purposes), so multiple unit-less "default"
-- configs could otherwise coexist. Enforce at most one default (unit_id IS NULL) row via a partial
-- unique index; the plain unique index above still enforces one config per non-null unit_id.
CREATE UNIQUE INDEX "ai_config_single_default" ON "ai_scheduling_config" ("unit_id") WHERE "unit_id" IS NULL;
