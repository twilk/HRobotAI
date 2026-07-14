-- Cross-unit replacement travel (2026-07-14 spec, Demo-MVP scope). Additive-only: new nullable/
-- defaulted columns on three existing tables, no drops, no data migration. --create-only, hand
-- authored (no live DB access from this environment) mirroring the Prisma-generated SQL shape used
-- by every prior migration in this tenant schema (see e.g. 20260713220000_position_cost_rate).
--
-- NOTE (live-apply gotcha carried from SP0/SP4): if applied to a shared demo DB where tables were
-- created by a `postgres` superuser role, no OWNER change is needed here (ALTER TABLE ADD COLUMN on
-- an existing table the tenant role can already write to does not require a new grant) — this note
-- is only a reminder that this migration is NOT applied by this change.

-- AlterTable: AiSchedulingConfig — travel policy (avgSpeedKmh/perKmRatePln/maxTravelMinutes/roundTrip).
ALTER TABLE "ai_scheduling_config"
  ADD COLUMN "avg_speed_kmh" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "per_km_rate_pln" DECIMAL(65,30) NOT NULL DEFAULT 1.15,
  ADD COLUMN "max_travel_minutes" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "round_trip" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: AiProposal — owningUnitId, the proposal's owning unit FROZEN at creation (Codex P1-2).
ALTER TABLE "ai_proposal"
  ADD COLUMN "owning_unit_id" TEXT;

-- AlterTable: AiProposalCandidate — persisted travel breakdown per candidate (nullable: unset for
-- rows created before this migration, and for a local candidate a 0 may be written explicitly by the
-- application rather than left null).
ALTER TABLE "ai_proposal_candidate"
  ADD COLUMN "travel_km" DECIMAL(65,30),
  ADD COLUMN "travel_minutes" DECIMAL(65,30),
  ADD COLUMN "travel_cost" DECIMAL(65,30);
