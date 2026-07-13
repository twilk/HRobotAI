-- UŻYTKOWNICY (user invites + RBAC role management): a GLOBAL role grant is a UserRole row with
-- unit_id IS NULL. The existing `@@unique([userId, role, unitId])` composite unique
-- (user_roles_user_id_role_unit_id_key) does NOT make global-role grants idempotent — Postgres
-- treats every NULL as distinct for uniqueness purposes, so the same (user_id, role) pair with
-- unit_id NULL could otherwise be inserted many times (e.g. a retried GRANT after a KC-fail
-- interleaving). Mirrors the ai_config_single_default hand-appended partial-unique index from
-- 20260713141706_ai_grafik/migration.sql. Additive-only: the composite unique above still
-- enforces one row per (user, role, unit) for unit-scoped grants.
--
-- Create-only; NOT applied to any live DB here (human gate).

CREATE UNIQUE INDEX "user_role_global_unique" ON "user_roles" ("user_id", "role") WHERE "unit_id" IS NULL;
