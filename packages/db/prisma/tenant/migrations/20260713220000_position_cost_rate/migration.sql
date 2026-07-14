-- SP4 (Budżetowanie kosztów) foundation: PositionCostRate — standard hourly cost per
-- (position, employmentType). Additive-only: one new table, no changes to existing objects.
-- Reuses the existing EmploymentType enum (no new enum). `overtimeMultiplier` is stored for a
-- future phase; the MVP cost calculator does not read it.
--
-- NOTE (live-apply gotcha carried from SP0): if this migration is applied to a shared demo DB
-- where tables are created by a `postgres` superuser role, remember to
-- `ALTER TABLE position_cost_rates OWNER TO hu_<tenant>` afterwards so the tenant's own DB role
-- can write to it. This migration is --create-only and is NOT applied here.

-- CreateTable
CREATE TABLE "position_cost_rates" (
    "id" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "employment_type" "EmploymentType" NOT NULL,
    "hourly_rate" DECIMAL(65,30) NOT NULL,
    "overtime_multiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.5,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_cost_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "position_cost_rates_position_employment_type_key" ON "position_cost_rates"("position", "employment_type");
