# HRobot

Multi-tenant HR SaaS for the Polish market (RODO-sensitive), built **database-per-tenant** +
**Keycloak realm-per-tenant**. A pnpm + turbo monorepo with two NestJS services, a data layer,
and an onboarding web app.

```
packages/config          Zod env validation (parseEnv)
packages/shared          domain enums + AES-256-GCM EncryptionService (versioned keyring, PESEL blind index)
packages/db              two Prisma schemas (control-plane + per-tenant) + TenantPrismaManager + migration fan-out
apps/control-plane       NestJS control plane: tenant signup + async provisioning + global-admin auth   (:3000)
apps/tenant-runtime      NestJS tenant runtime: Keycloak JWT, tenant context, RBAC, audit, employees     (:3001)
apps/web                 onboarding SPA + guided tour (drives both APIs)
```

## Prerequisites

- Node 22+ (the apps are CommonJS importing ESM `@hrobot/db` via Node 22 `require(esm)`)
- pnpm 10 (`corepack enable`)
- Docker (for the backing services)

## Quickstart (zero to running)

```bash
# 1. Env: copy the example, then regenerate the encryption key for anything shared.
cp .env.example .env
#    openssl rand -hex 32   # paste into TENANT_DB_ENCRYPTION_KEY

# 2. Backing services: Postgres, Redis, RabbitMQ, Keycloak.
docker compose up -d
docker compose ps              # wait until postgres/redis/rabbitmq are healthy

# 3. Install (postinstall generates the Prisma clients).
pnpm install

# 4. Migrate the control-plane database + seed a global admin.
pnpm --filter @hrobot/db migrate:control:deploy
pnpm --filter @hrobot/db seed:admin:dev      # admin@hrobot.local / admin12345

# 5. Run the services (each reads PORT).
pnpm --filter @hrobot/control-plane dev                 # http://localhost:3000
PORT=3001 pnpm --filter @hrobot/tenant-runtime dev      # http://localhost:3001

# 6. (Optional) the onboarding web app + guided tour.
node apps/web/serve.mjs                                  # http://localhost:5173
```

## Verify it works

All routes are under the `api` global prefix.

```bash
# Control-plane liveness / readiness (DB + Redis)
curl localhost:3000/api/health/live
curl localhost:3000/api/health/ready

# Global-admin login (returns a JWT)
curl -sX POST localhost:3000/api/auth/global/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@hrobot.local","password":"admin12345"}'

# Kick off a tenant signup (202 Accepted + jobId)
curl -sX POST localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"companyName":"Acme","slug":"acme","adminEmail":"owner@acme.test"}'
```

The signup returns a `jobId`; poll `GET /api/provision/status/:jobId` to watch the
state machine (`CREATE_DB → RUN_MIGRATIONS → SEED → KEYCLOAK_SETUP → DONE`).

## Build & test

```bash
pnpm build     # turbo: packages -> both apps
pnpm test      # 114 unit tests (shared 13, config 5, db 24, control-plane 30, tenant-runtime 42)
pnpm lint
```

## Run the services in containers (CI / prod parity)

```bash
docker compose --profile full up -d --build     # backing services + control-plane (:3000) + tenant-runtime (:3001)
```

Both app services are gated behind the `full` profile, so a bare `docker compose up -d` starts
only the backing services and never collides with host apps on :3000 / :3001.

## Run the M2 demo (4Mobility)

The Grafik + Agent demo runs on synthetic data (tenant `staging`, realm `hrobot-staging`).
Full walkthrough + talking points: `data/m2-evidence/demo-scenario-4mobility.md`.

```bash
# 1. Full stack up (see the containers section above).
docker compose --profile full up -d

# 2. Seed the demo Keycloak realm + 3 demo users. REQUIRED after every fresh `up` —
#    the dev Keycloak runs start-dev on an ephemeral H2 store, so the realm does NOT
#    survive a container recreate. If the script prints `UPDATE users SET keycloak_sub=…`
#    lines, run them against the tenant DB (Keycloak ignores client-supplied user ids).
node scripts/seed-keycloak-demo.mjs

# 3. Seed one pending shift-swap for the manager-approval step (J5). Re-run after any
#    "Generuj grafik" — a re-solve regenerates shifts and clears dependent swaps.
docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b < scripts/seed-demo-swap.sql

# 4. Demo UI (a host Node process, NOT in compose). start-live.mjs forces the correct
#    KEYCLOAK_* + TENANT_RUNTIME_URL env so the self-auth proxy works.
cd docs/design/web-kit && node start-live.mjs      # http://localhost:5601
```

Logins (real gate on :5601 → `/login`): `demo` / `demo-staging-2026` (ADMIN, full grafik),
`manager.demo` / `Manager!2026` (MANAGER, unit-scoped + swap approval),
`pracownik.demo` / `Pracownik!2026` (PRACOWNIK — Anna Kowalska, read-only "my schedule").

## Notes

- **Keycloak:** the `KEYCLOAK_SETUP` provisioning step authenticates to the master realm to
  create each tenant's realm/client/roles and the `hrobot_roles` mapper. The dev Keycloak boots
  `admin/admin`. Hardening the admin auth + a readiness gate for cold Keycloak starts is tracked
  in `TODOS.md`.
- **RODO:** PESEL (national ID) is encrypted at rest (AES-256-GCM, AAD-bound) and never returned
  by the employees endpoint; `audit_log` is append-only (UPDATE/DELETE/TRUNCATE blocked at the DB).
- **Reset state:** `docker compose down -v` wipes the Postgres volume; re-run the migrate + seed.
  The dev Keycloak has no mounted volume, so **any** `docker compose down` (even without `-v`)
  drops every realm. After a down/recreate, re-provision tenants (or, for the demo realm, re-run
  `node scripts/seed-keycloak-demo.mjs`).
