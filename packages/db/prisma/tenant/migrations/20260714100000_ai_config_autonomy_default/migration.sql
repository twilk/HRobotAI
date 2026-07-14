-- Cross-unit replacement travel (2026-07-14 spec §12 Etap 2, Demo-MVP scope). Column-default-only
-- change, no drops, no data migration. --create-only, hand authored (no live DB access from this
-- environment) mirroring the Prisma-generated SQL shape used by every prior migration in this
-- tenant schema. NOT applied to any live DB by this change.
--
-- A fresh unit's AiSchedulingConfig now defaults autonomyLevel to AUTO_ASK_CONSENT (was
-- SUGGEST_ONLY) so a newly provisioned unit asks the top reachable feasible candidate for consent
-- immediately rather than parking every replacement proposal in DRAFT. Existing rows are
-- UNCHANGED — this only flips the column default applied to future inserts that omit the column.

ALTER TABLE "ai_scheduling_config"
  ALTER COLUMN "autonomy_level" SET DEFAULT 'AUTO_ASK_CONSENT';
