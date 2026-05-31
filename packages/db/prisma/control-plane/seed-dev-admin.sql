-- Dev-only seed: one global admin so you can hit POST /api/auth/global/login.
-- Run via:  pnpm --filter @hrobot/db seed:admin:dev
--
-- The password hash is generated IN Postgres via pgcrypto's bcrypt
-- (gen_salt('bf', 10)), producing a $2a$ hash that the `bcrypt` npm lib
-- verifies natively. No Node-side hashing needed, so this stays dependency-free.
--
-- Credentials:  admin@hrobot.local  /  admin12345   (CHANGE before any shared env)
-- Idempotent: ON CONFLICT (email) keeps the existing row.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO global_admins (id, email, password_hash, created_at)
VALUES (
  gen_random_uuid(),
  'admin@hrobot.local',
  crypt('admin12345', gen_salt('bf', 10)),
  now()
)
ON CONFLICT (email) DO NOTHING;
