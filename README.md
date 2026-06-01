# HRobot — Control Plane (`apps/api`)

NestJS control plane for HRobot: tenant signup + async provisioning (per-tenant
Postgres database, Keycloak realm) plus global-admin auth. Part of a pnpm + turbo
monorepo (`@hrobot/api`, `@hrobot/db`, `@hrobot/config`, `@hrobot/shared`).

## Prerequisites

- Node 20+
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

# 3. Install + generate Prisma clients.
pnpm install
pnpm --filter @hrobot/db db:generate

# 4. Migrate the control-plane database.
pnpm --filter @hrobot/db migrate:control:deploy

# 5. Seed a global admin (admin@hrobot.local / admin12345).
pnpm --filter @hrobot/db seed:admin:dev

# 6. Run the API (http://localhost:3000).
pnpm --filter @hrobot/api dev
```

## Verify it works

All routes are under the `api` global prefix (`app.setGlobalPrefix('api')`).

```bash
# Liveness
curl localhost:3000/api/health/live        # -> {"status":"ok"}
# Readiness (checks control-plane DB + Redis)
curl localhost:3000/api/health/ready

# Global-admin login (returns a JWT)
curl -sX POST localhost:3000/api/auth/global/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@hrobot.local","password":"admin12345"}'

# Kick off a tenant signup (202 Accepted + jobId)
curl -sX POST localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"companyName":"Acme","slug":"acme","adminEmail":"owner@acme.test","adminPassword":"hunter2hunter2"}'
```

The signup returns a `jobId`; poll `GET /api/provision/status/:jobId` to watch the
state machine (`CREATE_DB → RUN_MIGRATIONS → SEED → KEYCLOAK_SETUP → DONE`).

## Notes

- **Keycloak last-mile:** the `KEYCLOAK_SETUP` provisioning step authenticates as a
  confidential admin client (`KEYCLOAK_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET`).
  The dev Keycloak boots with `admin/admin` but that client must be created once
  (master realm → Clients). Until then, the first four pipeline steps work and the
  job parks before `KEYCLOAK_SETUP`. Automating this (realm import) is tracked in
  `TODOS.md`.
- **Run the API in a container** (CI / prod parity) instead of on the host:
  `docker compose up --build api` (or `docker compose --profile full up -d --build`). It's gated
  behind the `full` profile, so it won't collide with a host `pnpm dev` on :3000. The image was
  verified end-to-end: boot, `/api/health/ready` (DB+Redis up), and global-admin login.
- **Reset state:** `docker compose down -v` wipes the Postgres volume; re-run steps 4–6.
- **Tests:** `pnpm --filter @hrobot/api exec jest --config jest.config.cjs`.
