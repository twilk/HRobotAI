-- Idempotent: bring a tenant DB up to the M2 module schema (Wnioski leave-decision columns,
-- Ustawienia CompanySettings singleton, Dostępy AccessGrant, Koszty PositionCostRate, Użytkownicy
-- global-role idempotency). Mirrors migrations 20260713211107_core_modules + 20260713220000_
-- position_cost_rate, but every statement is IF-NOT-EXISTS / guarded so `demo-up.mjs` can re-run it.
--
-- Run as postgres; demo-up.mjs fixes object ownership to the tenant app role afterwards. Safe on a
-- freshly-provisioned tenant too (objects already created by `prisma migrate deploy` as the app
-- role) — every statement no-ops when the object already exists.

-- enums (CREATE TYPE has no IF NOT EXISTS; guard on duplicate_object)
DO $$ BEGIN CREATE TYPE "AccessType"   AS ENUM ('CARD','KEY','PERMISSION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccessStatus" AS ENUM ('ACTIVE','REVOKED','LOST');  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Wnioski: leave-decision columns + PENDING default (leave_requests already exists pre-M2)
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS decided_at         TIMESTAMP(3);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS decided_by_user_id TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reason             TEXT;
ALTER TABLE leave_requests ALTER COLUMN status SET DEFAULT 'PENDING';

-- Ustawienia: company settings singleton
CREATE TABLE IF NOT EXISTS company_settings (
  "id"          TEXT NOT NULL,
  "company_name" TEXT NOT NULL,
  "timezone"    TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  "region"      TEXT NOT NULL DEFAULT 'EU-Central',
  "locale"      TEXT NOT NULL DEFAULT 'pl-PL',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- Dostępy: access grants
CREATE TABLE IF NOT EXISTS access_grant (
  "id"                TEXT NOT NULL,
  "employee_id"       TEXT NOT NULL,
  "type"              "AccessType" NOT NULL,
  "label"             TEXT NOT NULL,
  "identifier"        TEXT,
  "lokalizacja_id"    TEXT,
  "status"            "AccessStatus" NOT NULL DEFAULT 'ACTIVE',
  "issued_by_user_id" TEXT,
  "issued_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at"        TIMESTAMP(3),
  "notes"             TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "access_grant_pkey" PRIMARY KEY ("id")
);

-- Koszty: standard hourly cost per (position, employment_type)
CREATE TABLE IF NOT EXISTS position_cost_rates (
  "id"                  TEXT NOT NULL,
  "position"            TEXT NOT NULL,
  "employment_type"     "EmploymentType" NOT NULL,
  "hourly_rate"         DECIMAL(65,30) NOT NULL,
  "overtime_multiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.5,
  "currency"            TEXT NOT NULL DEFAULT 'PLN',
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "position_cost_rates_pkey" PRIMARY KEY ("id")
);

-- FKs (ADD CONSTRAINT has no IF NOT EXISTS; guard on duplicate_object)
DO $$ BEGIN ALTER TABLE leave_requests ADD CONSTRAINT "leave_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES users("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE access_grant ADD CONSTRAINT "access_grant_employee_id_fkey"       FOREIGN KEY ("employee_id")    REFERENCES employees("id")   ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE access_grant ADD CONSTRAINT "access_grant_lokalizacja_id_fkey"    FOREIGN KEY ("lokalizacja_id") REFERENCES lokalizacje("id") ON DELETE SET NULL  ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE access_grant ADD CONSTRAINT "access_grant_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES users("id")     ON DELETE SET NULL  ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- indexes + partial-unique constraints
CREATE INDEX        IF NOT EXISTS "access_grant_employee_id_idx"                     ON access_grant("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "company_settings_singleton"                       ON company_settings((true));
CREATE UNIQUE INDEX IF NOT EXISTS "access_grant_active_identifier"                   ON access_grant("type","identifier") WHERE "status" = 'ACTIVE' AND "identifier" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "user_role_global_uniq"                            ON user_roles("user_id","role")      WHERE "unit_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "position_cost_rates_position_employment_type_key" ON position_cost_rates("position","employment_type");
