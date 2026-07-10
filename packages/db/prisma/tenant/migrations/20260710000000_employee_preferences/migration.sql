-- Employee soft scheduling preferences (FOUNDATION phase): two defaulted array columns the solver
-- will later optimize toward as SOFT terms (preferred days off + preferred shift start times).
-- Additive only — new columns with a DEFAULT so existing rows backfill to empty arrays with no data
-- migration. No changes to existing objects. The solver soft-term/packing land in a later phase.

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "preferred_days_off" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "preferred_shift_start" TEXT[] DEFAULT ARRAY[]::TEXT[];
