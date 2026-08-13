-- K7: monthly headcount per tenant — the input any per-seat pricing model needs.
--
-- Lives in the control-plane DB because database-per-tenant makes "how many people are in the
-- product across all customers" an N-database fan-out otherwise. One row per (tenant, month);
-- the nightly pass UPSERTs on that pair, so re-running it overwrites instead of accumulating.
--
-- `employees_on_record` counts Employee rows in the tenant DB — people on the books. It is NOT
-- "currently employed": the tenant schema carries `hired_at` and no termination/employment-status
-- column, so that is not derivable today. The column is named for what it counts on purpose; the
-- retired turnover metrics went wrong precisely by giving a number a name it did not earn.
CREATE TABLE "tenant_usage_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "employees_on_record" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- The upsert target. Without this the nightly pass would append a duplicate row per run.
CREATE UNIQUE INDEX "tenant_usage_snapshots_tenant_id_month_key"
    ON "tenant_usage_snapshots"("tenant_id", "month");

-- Serves the only cross-tenant question this table exists for: "total seats in month M".
CREATE INDEX "tenant_usage_snapshots_month_idx" ON "tenant_usage_snapshots"("month");
