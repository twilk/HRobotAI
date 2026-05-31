<!-- /autoplan restore point: /c/Users/Wilk/.gstack/projects/HRobot/master-autoplan-restore-20260531-005107-plan02.md -->
# Foundation Plan 2 — NestJS Control Plane & Provisioning Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/api` — the NestJS control-plane HTTP server and async tenant provisioning pipeline that takes a signup request from `202 Accepted` to a fully provisioned, Keycloak-authenticated tenant.

**Architecture:** A NestJS hybrid application (HTTP/Express + RabbitMQ AMQP consumer in one process). The `ControlPlanePrismaService` wraps the generated `ControlPlaneClient` from `@hrobot/db`. An `OutboxRelayService` cron runs every 5 s, publishing pending `outbox_events` to RabbitMQ. A `ProvisioningConsumer` drives an idempotent state machine (`CREATE_DB → RUN_MIGRATIONS → SEED → KEYCLOAK_SETUP → DONE`) with 3-attempt exponential-backoff retry and compensating rollback on permanent failure.

**Tech Stack:** NestJS 10, Express platform, `@nestjs/microservices` (RabbitMQ AMQP), `@nestjs/schedule` (cron), `@nestjs/terminus` (health), `@nestjs/throttler` v6 + `nestjs-throttler-storage-redis` + `ioredis` (rate limiting), `@nestjs/passport` + `passport-jwt` + `bcrypt` (global admin auth), `nestjs-pino` (structured JSON logging), `prom-client` (Prometheus), `pg` (superuser raw SQL for DB creation), TypeScript 5 strict.

**Scope boundary:** Plan 2 of 5. Delivers unauthenticated/global-admin-authenticated control-plane endpoints and the full provisioning pipeline. The tenant-scoped runtime (`TenantContextInterceptor`, `RbacGuard`, `AuditInterceptor`, `EmployeesModule`) is Plan 3.

---

## ⚠ APPLIED REVIEW FIXES — MANDATORY, supersede the inline code below (folded 2026-05-31 by /autoplan)

Both independent reviewers returned "NOT mergeable as written." These corrections fix the
7 merge-blockers + critical first-run DX gaps. **They supersede the inline code in the
referenced Tasks.** Orchestrator stays RabbitMQ+outbox (user decision D4=A); retry durability
is fixed by a durable schedule, not by dropping RMQ. Smaller cleanups are in the review report
(end of file) as a checklist.

**Prereq schema change (Plan 1 `packages/db/prisma/control-plane/schema.prisma`):** add
`nextAttemptAt DateTime?` to `ProvisioningJob` (+ migration). Required by FIX-C1.

### FIX-C1 — durable retry (Task 7, `provisioning.service.ts`): replace the `setTimeout` re-enqueue
In-process `setTimeout` is lost on pod restart → tenant stuck forever. Persist the schedule;
a RetryRelay cron re-emits due jobs to the existing RMQ queue. Replace the retry branch with:
```typescript
const delayMs = RETRY_DELAYS_MS[job.attemptCount] ?? 600_000
await this.prisma.provisioningJob.update({
  where: { id: job.id },
  data: { attemptCount: nextAttempt, lastError: sanitizeError(message),
          nextAttemptAt: new Date(Date.now() + delayMs) },
})
this.logger.warn({ jobId: job.id, delayMs }, 'Scheduled durable retry')
// NO setTimeout. RetryRelay (below) re-enqueues when nextAttemptAt <= now.
```
Also fix the permanent-FAIL branch to `lastError: sanitizeError(message)`. Add a `RetryRelay`
(mirrors OutboxRelay, `@Cron('*/10 * * * * *')`):
```typescript
const due = await this.prisma.provisioningJob.findMany({
  where: { step: { notIn: [ProvisioningStep.DONE, ProvisioningStep.FAILED] },
           nextAttemptAt: { lte: new Date() } }, take: 50 })
for (const job of due) {
  await this.prisma.provisioningJob.update({ where: { id: job.id }, data: { nextAttemptAt: null } })
  await firstValueFrom(this.client.emit('tenant.provision', { jobId: job.id, tenantId: job.tenantId }))
}
```
Add `sanitizeError()` to a shared util: `s.replace(/postgresql:\/\/[^@\s]*@/gi, 'postgresql://***@').replace(/Bearer\s+[\w.-]+/gi, 'Bearer ***')`.

### FIX-C2 — CREATE_DB idempotency (Task 8, `create-db.step.ts`)
Generate+persist the password BEFORE DDL; guard role/db creation so retry converges:
```typescript
// generate once, persist encrypted BEFORE DDL so a retry reuses the same password
const dbPassword = randomBytes(24).toString('base64url')
const dbUrl = `postgresql://${dbUser}:${dbPassword}@${host}:${port}/${dbName}`
await this.prisma.tenant.update({ where: { id: job.tenantId }, data: { dbUrl: this.encryption.encrypt(dbUrl) } })
// idempotent role: CREATE ROLE only if absent; otherwise reset its password
await this.pg.query(
  `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=$1) THEN
     EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', $1, $2);
   ELSE EXECUTE format('ALTER ROLE %I PASSWORD %L', $1, $2); END IF; END $$;`,
  [dbUser, dbPassword])
// idempotent db: skip if it already exists (CREATE DATABASE has no IF NOT EXISTS)
const { rows } = await this.pg.query(`SELECT 1 FROM pg_database WHERE datname=$1`, [dbName])
if (rows.length === 0) await this.pg.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`)
```
Use the **full** `tenant.id` (hyphens stripped) for `dbName`/`dbUser`, not an 8-char slice (FIX-M1).

### FIX-C3 — outbox row claim (Task 6, `outbox-relay.service.ts`) — and the same for RetryRelay
Multi-pod cron double-publishes. Claim atomically before emit:
```typescript
const events = await this.prisma.$queryRaw`
  UPDATE outbox_events SET published_at = now()
  WHERE id IN (SELECT id FROM outbox_events WHERE published_at IS NULL
               ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED)
  RETURNING id, routing_key AS "routingKey", payload`
// NOTE: $queryRaw RETURNING gives raw column names — alias snake_case → camelCase
// (routing_key AS "routingKey") or the loop's event.routingKey is undefined.
for (const event of events) {
  try { await firstValueFrom(this.client.emit(event.routingKey, event.payload)) }
  catch (err) { /* re-null published_at for a bounded number of attempts; alert past cap */ }
}
```

### FIX-C4 — Keycloak idempotent + checked (Task 10, `keycloak-setup.step.ts`)
Check every response; GET-or-create on 409; never derive userId from Location alone; DONE only
after invariants verified. Wrap fetches:
```typescript
const kc = async (url, init) => { const r = await this.fetchFn(url, init)
  if (!r.ok && r.status !== 409) throw new Error(`keycloak ${init.method} ${url} -> ${r.status}`); return r }
// realm/client/user: on 409, GET the existing resource and reuse its id.
// user id: if Location missing, GET /users?email=<adminEmail> and take [0].id.
// ALWAYS send execute-actions-email; only then advance. Verify realm+client+user exist before DONE.
```

### FIX-C4b (CRITICAL, cross-plan — breaks Plan 3 RBAC) — create roles + `hrobot_roles` mapper + assign
KEYCLOAK_SETUP creates a realm/client/user but **no roles and no protocol mapper**, so the JWT never
carries `hrobot_roles` → Plan 3's `@Roles(ADMIN_KLIENTA)` can never pass (the tenant admin is 403'd
on their own onboarding). Verified missing in the live `hrobot-control-plane-api` worktree (task chip
spawned). After creating the realm, also:
- create the **4 tenant realm roles** that match Plan 1's `Role` enum: `PRACOWNIK`, `MANAGER`,
  `HR`, `ADMIN_KLIENTA`. Do NOT create `ADMIN_GLOBALNY` here — global admin is a control-plane
  concept (Plan 2 Task 4's global-admin JWT), not a tenant realm role; Plan 3's `Role`-typed
  `@Roles()` cannot reference it, so emitting it in `hrobot_roles` would be unusable;
- add a **User Realm Role** protocol mapper on the `hrobot-web` client emitting a multivalued
  `hrobot_roles` claim in the access token;
- assign `ADMIN_KLIENTA` to the initial admin user (`POST /admin/realms/{realm}/users/{id}/role-mappings/realm`).

### FIX-C5 — non-blocking migrate + packaging (Task 9, `run-migrations.step.ts`)
`spawnSync` blocks the HTTP+AMQP event loop. Use async + timeout:
```typescript
import { execFile } from 'node:child_process'; import { promisify } from 'node:util'
const run = promisify(execFile)
try {
  await run('pnpm', ['prisma','migrate','deploy','--schema=packages/db/prisma/tenant/schema.prisma'],
            { env: { ...process.env, DATABASE_URL: dbUrl }, timeout: 120_000 })
} catch (e) { throw new Error(sanitizeError(String((e as any).stderr ?? e))) }
```
**Packaging requirement (add to deploy docs):** the API image MUST contain the `prisma` CLI +
`packages/db/prisma/tenant/` (schema + migrations) + `pnpm` on PATH, CWD = repo root. Add an
integration test that runs a real `migrate deploy` against a throwaway DB.

### FIX-H1 — status endpoint contract (Tasks 7 & 11, `provisioning.controller.ts`)
Return a coarse, frontend-usable shape; never raw `lastError`:
```typescript
async status(@Param('jobId') jobId: string): Promise<{
  step: string; attemptCount: number; done: boolean; failed: boolean; errorCode: string | null }> {
  const job = await this.prisma.provisioningJob.findUnique({ where: { id: jobId } })
  if (!job) throw new NotFoundException('Provisioning job not found')
  const failed = job.step === ProvisioningStep.FAILED
  return { step: job.step, attemptCount: job.attemptCount,
           done: failed || job.step === ProvisioningStep.DONE, failed,
           errorCode: failed ? 'PROVISIONING_FAILED' : null }
}
```

### FIX-M4 — validate LoginDto (Task 4, `auth.controller.ts`) — folded inline below too.

### DX first-run fixes (new Task 1 additions)
- **Create root `.env.example`** with all 10 vars, values matching the Plan-1 docker-compose
  stack (superuser **`POSTGRES_SUPERUSER_URL=postgresql://hrobot:hrobot@localhost:5432/postgres`**
  — Plan-1 compose uses user `hrobot` on `5432`, NOT `postgres@5433`).
- **Keycloak admin auth:** the step uses a password grant but only `KEYCLOAK_ADMIN_CLIENT_SECRET`
  is in `env.ts`. Either add `KEYCLOAK_ADMIN_PASSWORD` to the schema and use it, or (preferred)
  switch `getAdminToken` to `grant_type=client_credentials` with a confidential admin client.
- **Global-admin seed:** add a `packages/db` seed step that inserts one `globalAdmin`
  (bcrypt hash from an env-provided bootstrap password) — otherwise `/auth/global/login` is 401.
- **Quickstart:** add `apps/api/README.md`: install → `.env` → compose up → control-plane migrate
  → seed admin → `pnpm dev` → sample `curl` signup → poll status → ACTIVE.
- **docker-compose:** add an `api` service (or document the `pnpm dev` step) — spec promised
  `docker compose up` brings up the API.

---

## File Structure

**New package `apps/api/`:**
```
apps/api/
├── src/
│   ├── main.ts                                  # Bootstrap hybrid app (HTTP + AMQP)
│   ├── app.module.ts                            # Root module
│   ├── common/
│   │   ├── prisma/
│   │   │   ├── control-plane-prisma.service.ts  # NestJS lifecycle wrapper for ControlPlaneClient
│   │   │   └── control-plane-prisma.service.spec.ts
│   │   ├── redis/
│   │   │   └── redis.service.ts                 # ioredis injectable
│   │   └── common.module.ts                     # @Global: exports PrismaService + RedisService
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.controller.ts                 # GET /health/live, GET /health/ready
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts                   # POST /api/auth/global/login
│   │   ├── auth.service.ts                      # bcrypt verify, sign JWT
│   │   ├── auth.service.spec.ts
│   │   ├── global-admin.guard.ts                # Passport JWT guard
│   │   └── global-admin.strategy.ts             # JWT strategy reads GLOBAL_ADMIN_JWT_SECRET
│   ├── tenants/
│   │   ├── tenants.module.ts
│   │   ├── tenants.controller.ts                # GET /api/slugs/check/:slug, POST /api/auth/signup
│   │   ├── tenants.service.ts                   # slug check; signup tx (tenant+job+outbox)
│   │   ├── tenants.service.spec.ts
│   │   └── dto/
│   │       └── signup.dto.ts                    # class-validator DTO
│   ├── outbox/
│   │   ├── outbox.module.ts
│   │   ├── outbox-relay.service.ts              # @Cron 5s: poll outbox_events → emit to RMQ
│   │   └── outbox-relay.service.spec.ts
│   └── provisioning/
│       ├── provisioning.module.ts
│       ├── provisioning.consumer.ts             # @MessagePattern('tenant.provision')
│       ├── provisioning.controller.ts           # GET /api/provision/status/:jobId
│       ├── provisioning.service.ts              # Step dispatch, retry, rollback
│       ├── provisioning.service.spec.ts
│       └── steps/
│           ├── create-db.step.ts                # CREATE USER + DATABASE + encrypt url
│           ├── run-migrations.step.ts           # spawnSync prisma migrate deploy
│           ├── seed.step.ts                     # Insert root OrganizationalUnit
│           ├── keycloak-setup.step.ts           # Keycloak Admin REST API
│           └── done.step.ts                     # SET status=ACTIVE, provisioned_at
├── package.json
├── tsconfig.json
├── nest-cli.json
└── jest.config.cjs
```

**Modified files (from Plan 1):**
- `packages/config/src/env.ts` — add `POSTGRES_SUPERUSER_URL`, `GLOBAL_ADMIN_JWT_SECRET`
- `packages/config/src/env.test.ts` — add new vars to the `valid` fixture
- `.env.example` (worktree root) — add example values for new vars

---

## Task 1: apps/api scaffold + env additions

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/jest.config.cjs`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@hrobot/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main",
    "dev": "nest start --watch",
    "lint": "eslint src",
    "test": "jest --config jest.config.cjs"
  },
  "dependencies": {
    "@hrobot/config": "workspace:*",
    "@hrobot/db": "workspace:*",
    "@hrobot/shared": "workspace:*",
    "@nestjs/common": "^10.3.10",
    "@nestjs/core": "^10.3.10",
    "@nestjs/microservices": "^10.3.10",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.3.10",
    "@nestjs/schedule": "^4.1.0",
    "@nestjs/terminus": "^10.2.3",
    "@nestjs/throttler": "^6.2.1",
    "@willsoto/nestjs-prometheus": "^6.0.0",
    "amqplib": "^0.10.4",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^5.3.2",
    "jsonwebtoken": "^9.0.2",
    "nestjs-pino": "^4.1.0",
    "nestjs-throttler-storage-redis": "^0.4.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pg": "^8.12.0",
    "pino": "^9.2.0",
    "pino-http": "^10.2.0",
    "prom-client": "^15.1.3",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/schematics": "^10.1.4",
    "@nestjs/testing": "^10.3.10",
    "@types/amqplib": "^0.10.5",
    "@types/bcrypt": "^5.0.2",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^22.0.0",
    "@types/passport-jwt": "^4.0.1",
    "@types/pg": "^8.11.6",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.3",
    "typescript": "^5.5.3"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../packages/config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

- [ ] **Step 3: Create `apps/api/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

- [ ] **Step 4: Create `apps/api/jest.config.cjs`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }],
  },
}
```

- [ ] **Step 5: Create `apps/api/src/app.module.ts`** (empty shell, expanded in later tasks)

```typescript
import { Module } from '@nestjs/common'

@Module({ imports: [] })
export class AppModule {}
```

- [ ] **Step 6: Create `apps/api/src/main.ts`**

```typescript
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { Transport, type MicroserviceOptions } from '@nestjs/microservices'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'
import { parseEnv } from '@hrobot/config'

async function bootstrap(): Promise<void> {
  const env = parseEnv()

  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.setGlobalPrefix('api')

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [env.RABBITMQ_URL],
      queue: 'tenant.provision',
      queueOptions: { durable: true },
      noAck: false,
    },
  })

  await app.startAllMicroservices()
  const port = Number(process.env['PORT'] ?? 3000)
  await app.listen(port)
}

void bootstrap()
```

- [ ] **Step 7: Extend `packages/config/src/env.ts`** — add two new required vars

Replace the `envSchema` object with:

```typescript
export const envSchema = z.object({
  CONTROL_PLANE_DATABASE_URL: z.string().url(),
  // 32-byte AES-256 key, hex-encoded → 64 hex chars
  TENANT_DB_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TENANT_DB_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(1),
  // Plan 2 additions
  POSTGRES_SUPERUSER_URL: z.string().url(),
  GLOBAL_ADMIN_JWT_SECRET: z
    .string()
    .min(32, 'GLOBAL_ADMIN_JWT_SECRET must be at least 32 characters'),
})
```

- [ ] **Step 8: Update `packages/config/src/env.test.ts`** — add new vars to the `valid` fixture

```typescript
const valid = {
  CONTROL_PLANE_DATABASE_URL: 'postgresql://u:p@localhost:5432/hrobot_control',
  TENANT_DB_ENCRYPTION_KEY: 'a'.repeat(64),
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_CLIENT_ID: 'hrobot-web',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  NEXTAUTH_SECRET: 'nextauth-secret',
  POSTGRES_SUPERUSER_URL: 'postgresql://postgres:postgres@localhost:5433/postgres',
  GLOBAL_ADMIN_JWT_SECRET: 'a'.repeat(32),
}
```

- [ ] **Step 9: Run existing config tests — must still pass**

```
cd packages/config && pnpm test
```
Expected: 4 tests green.

- [ ] **Step 10: Install dependencies**

```
pnpm install
```

- [ ] **Step 11: Verify apps/api compiles**

```
cd apps/api && pnpm build
```
Expected: `dist/main.js` created, no TypeScript errors.

- [ ] **Step 12: Commit**

```bash
git add apps/api packages/config/src/env.ts packages/config/src/env.test.ts
git commit -m "feat(api): scaffold NestJS apps/api; extend env with POSTGRES_SUPERUSER_URL + GLOBAL_ADMIN_JWT_SECRET"
```

---

## Task 2: CommonModule — ControlPlanePrismaService + RedisService

**Files:**
- Create: `apps/api/src/common/prisma/control-plane-prisma.service.ts`
- Create: `apps/api/src/common/prisma/control-plane-prisma.service.spec.ts`
- Create: `apps/api/src/common/redis/redis.service.ts`
- Create: `apps/api/src/common/common.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/common/prisma/control-plane-prisma.service.spec.ts`:

```typescript
import { ControlPlanePrismaService } from './control-plane-prisma.service.js'

describe('ControlPlanePrismaService', () => {
  it('calls $connect on init and $disconnect on destroy', async () => {
    const service = new ControlPlanePrismaService()
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined)
    const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined)

    await service.onModuleInit()
    await service.onModuleDestroy()

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=control-plane-prisma
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/common/prisma/control-plane-prisma.service.ts`**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ControlPlaneClient } from '@hrobot/db'

@Injectable()
export class ControlPlanePrismaService
  extends ControlPlaneClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
```

- [ ] **Step 4: Create `apps/api/src/common/redis/redis.service.ts`**

```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'
import { parseEnv } from '@hrobot/config'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  readonly client: Redis

  constructor() {
    const { REDIS_URL } = parseEnv()
    this.client = new Redis(REDIS_URL)
    this.client.on('error', (err: Error) =>
      this.logger.error({ err }, 'Redis connection error'),
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
```

- [ ] **Step 5: Create `apps/api/src/common/common.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common'
import { ControlPlanePrismaService } from './prisma/control-plane-prisma.service.js'
import { RedisService } from './redis/redis.service.js'

@Global()
@Module({
  providers: [ControlPlanePrismaService, RedisService],
  exports: [ControlPlanePrismaService, RedisService],
})
export class CommonModule {}
```

- [ ] **Step 6: Register CommonModule in `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { CommonModule } from './common/common.module.js'

@Module({ imports: [CommonModule] })
export class AppModule {}
```

- [ ] **Step 7: Run test — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=control-plane-prisma
```
Expected: 1 test green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common apps/api/src/app.module.ts
git commit -m "feat(api): add CommonModule with ControlPlanePrismaService and RedisService"
```

---

## Task 3: HealthModule

**Files:**
- Create: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/src/health/health.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common'
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthCheckError,
  HealthIndicatorResult,
} from '@nestjs/terminus'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { RedisService } from '../common/redis/redis.service.js'

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: ControlPlanePrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' }
  }

  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.prisma.$queryRaw`SELECT 1`
          return { 'control-plane-db': { status: 'up' } }
        } catch (err) {
          throw new HealthCheckError('DB unavailable', {
            'control-plane-db': { status: 'down', message: String(err) },
          })
        }
      },
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.redis.client.ping()
          return { redis: { status: 'up' } }
        } catch (err) {
          throw new HealthCheckError('Redis unavailable', {
            redis: { status: 'down', message: String(err) },
          })
        }
      },
    ])
  }
}
```

- [ ] **Step 2: Create `apps/api/src/health/health.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'
import { HealthController } from './health.controller.js'

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 3: Register HealthModule in `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { CommonModule } from './common/common.module.js'
import { HealthModule } from './health/health.module.js'

@Module({ imports: [CommonModule, HealthModule] })
export class AppModule {}
```

- [ ] **Step 4: Verify build**

```
cd apps/api && pnpm build
```
Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/health apps/api/src/app.module.ts
git commit -m "feat(api): add HealthModule with /health/live and /health/ready"
```

---

## Task 4: GlobalAdminAuthModule

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`
- Create: `apps/api/src/auth/global-admin.strategy.ts`
- Create: `apps/api/src/auth/global-admin.guard.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/auth.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import * as bcrypt from 'bcrypt'

const mockPrisma = {
  globalAdmin: { findUnique: jest.fn() },
}

describe('AuthService', () => {
  let service: AuthService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get(AuthService)
    jest.clearAllMocks()
  })

  it('returns a JWT when credentials are valid', async () => {
    const hash = await bcrypt.hash('correct-password', 1)
    mockPrisma.globalAdmin.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@hrobot.ai',
      passwordHash: hash,
    })

    const result = await service.login('admin@hrobot.ai', 'correct-password')
    expect(result.accessToken).toBeDefined()
    expect(typeof result.accessToken).toBe('string')
  })

  it('throws UnauthorizedException for wrong password', async () => {
    const hash = await bcrypt.hash('real-password', 1)
    mockPrisma.globalAdmin.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@hrobot.ai',
      passwordHash: hash,
    })

    await expect(service.login('admin@hrobot.ai', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('throws UnauthorizedException when admin not found', async () => {
    mockPrisma.globalAdmin.findUnique.mockResolvedValue(null)
    await expect(service.login('nobody@hrobot.ai', 'any')).rejects.toThrow(
      UnauthorizedException,
    )
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=auth.service
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/auth/auth.service.ts`**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import * as jwt from 'jsonwebtoken'
import { parseEnv } from '@hrobot/config'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Injectable()
export class AuthService {
  private readonly jwtSecret = parseEnv().GLOBAL_ADMIN_JWT_SECRET

  constructor(private readonly prisma: ControlPlanePrismaService) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const admin = await this.prisma.globalAdmin.findUnique({ where: { email } })
    if (!admin) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(password, admin.passwordHash)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    const accessToken = jwt.sign(
      { sub: admin.id, email: admin.email, role: 'GLOBAL_ADMIN' },
      this.jwtSecret,
      { expiresIn: '8h' },
    )
    return { accessToken }
  }
}
```

- [ ] **Step 4: Create `apps/api/src/auth/global-admin.strategy.ts`**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { parseEnv } from '@hrobot/config'

interface JwtPayload {
  sub: string
  email: string
  role: string
}

@Injectable()
export class GlobalAdminStrategy extends PassportStrategy(Strategy, 'global-admin-jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: parseEnv().GLOBAL_ADMIN_JWT_SECRET,
    })
  }

  validate(payload: JwtPayload): JwtPayload {
    if (payload.role !== 'GLOBAL_ADMIN') throw new UnauthorizedException()
    return payload
  }
}
```

- [ ] **Step 5: Create `apps/api/src/auth/global-admin.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class GlobalAdminGuard extends AuthGuard('global-admin-jwt') {}
```

- [ ] **Step 6: Create `apps/api/src/auth/auth.controller.ts`**

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { IsEmail, IsString, MinLength } from 'class-validator'
import { AuthService } from './auth.service.js'

// FIX-M4: without class-validator decorators, the global ValidationPipe({whitelist:true})
// strips email/password to undefined → bcrypt.compare(undefined,...) → login can never succeed.
class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(1)
  password!: string
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('global/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    return this.auth.login(dto.email, dto.password)
  }
}
```

- [ ] **Step 7: Create `apps/api/src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { AuthService } from './auth.service.js'
import { AuthController } from './auth.controller.js'
import { GlobalAdminStrategy } from './global-admin.strategy.js'

@Module({
  imports: [PassportModule],
  providers: [AuthService, GlobalAdminStrategy],
  controllers: [AuthController],
  exports: [GlobalAdminGuard],
})
export class AuthModule {}
```

Wait — `GlobalAdminGuard` must be exported from auth.module.ts but it is not yet a provider. Add it:

```typescript
import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { AuthService } from './auth.service.js'
import { AuthController } from './auth.controller.js'
import { GlobalAdminStrategy } from './global-admin.strategy.js'
import { GlobalAdminGuard } from './global-admin.guard.js'

@Module({
  imports: [PassportModule],
  providers: [AuthService, GlobalAdminStrategy, GlobalAdminGuard],
  controllers: [AuthController],
  exports: [GlobalAdminGuard],
})
export class AuthModule {}
```

- [ ] **Step 8: Register AuthModule in `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { CommonModule } from './common/common.module.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'

@Module({ imports: [CommonModule, HealthModule, AuthModule] })
export class AppModule {}
```

- [ ] **Step 9: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=auth.service
```
Expected: 3 tests green.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/auth apps/api/src/app.module.ts
git commit -m "feat(api): add GlobalAdminAuthModule with bcrypt login and JWT guard"
```

---

## Task 5: TenantsModule — slug check + signup

**Files:**
- Create: `apps/api/src/tenants/dto/signup.dto.ts`
- Create: `apps/api/src/tenants/tenants.service.ts`
- Create: `apps/api/src/tenants/tenants.service.spec.ts`
- Create: `apps/api/src/tenants/tenants.controller.ts`
- Create: `apps/api/src/tenants/tenants.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/src/tenants/dto/signup.dto.ts`**

```typescript
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class SignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName!: string

  /**
   * 3-30 lowercase alphanumeric chars + hyphens; no leading/trailing hyphens.
   * Frontend auto-lowercases and replaces spaces. Backend re-validates.
   */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, {
    message: 'slug must be 3–30 lowercase alphanumeric characters/hyphens with no leading or trailing hyphen',
  })
  slug!: string

  @IsEmail({}, { message: 'adminEmail must be a valid email address' })
  adminEmail!: string
}
```

**Note:** No password field — the initial admin user is created in KEYCLOAK_SETUP with a system-generated temporary credential; Keycloak sends a credential-reset email so the admin sets their own password.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/tenants/tenants.service.spec.ts`:

```typescript
import { ConflictException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { TenantsService } from './tenants.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

const mockJob = { id: 'job-1' }
const mockTenant = { id: 'tenant-1', slug: 'acme' }

const mockPrisma = {
  tenant: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
}

describe('TenantsService', () => {
  let service: TenantsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get(TenantsService)
    jest.clearAllMocks()
  })

  describe('isSlugAvailable', () => {
    it('returns true when no tenant has the slug', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue(null)
      expect(await service.isSlugAvailable('acme')).toBe(true)
    })

    it('returns false when slug is taken', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue(mockTenant)
      expect(await service.isSlugAvailable('acme')).toBe(false)
    })
  })

  describe('signup', () => {
    it('returns jobId on successful signup', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<{ jobId: string }>) => {
        return fn({
          tenant: { create: jest.fn().mockResolvedValue(mockTenant) },
          provisioningJob: { create: jest.fn().mockResolvedValue(mockJob) },
          outboxEvent: { create: jest.fn().mockResolvedValue({}) },
        } as unknown as typeof mockPrisma)
      })

      const result = await service.signup({
        companyName: 'Acme Corp',
        slug: 'acme',
        adminEmail: 'admin@acme.com',
      })
      expect(result).toEqual({ jobId: 'job-1' })
    })

    it('throws ConflictException with Polish message on duplicate slug (P2002)', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' })
      mockPrisma.$transaction.mockRejectedValue(p2002)

      await expect(
        service.signup({ companyName: 'Acme', slug: 'acme', adminEmail: 'a@b.com' }),
      ).rejects.toThrow(ConflictException)

      await expect(
        service.signup({ companyName: 'Acme', slug: 'acme', adminEmail: 'a@b.com' }),
      ).rejects.toMatchObject({ response: { message: 'Ta nazwa jest już zajęta' } })
    })
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=tenants.service
```
Expected: FAIL — module not found.

- [ ] **Step 4: Create `apps/api/src/tenants/tenants.service.ts`**

```typescript
import { ConflictException, Injectable } from '@nestjs/common'
import { ProvisioningStep, TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import type { SignupDto } from './dto/signup.dto.js'

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  async isSlugAvailable(slug: string): Promise<boolean> {
    const existing = await this.prisma.tenant.findFirst({ where: { slug } })
    return existing === null
  }

  async signup(dto: SignupDto): Promise<{ jobId: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            slug: dto.slug,
            name: dto.companyName,
            status: TenantStatus.PENDING,
            metadata: { adminEmail: dto.adminEmail },
          },
        })

        const job = await tx.provisioningJob.create({
          data: {
            tenantId: tenant.id,
            step: ProvisioningStep.CREATE_DB,
            attemptCount: 0,
          },
        })

        await tx.outboxEvent.create({
          data: {
            exchange: 'tenant.provision',
            routingKey: 'tenant.provision',
            payload: { jobId: job.id, tenantId: tenant.id },
          },
        })

        return { jobId: job.id }
      })
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException({ field: 'slug', message: 'Ta nazwa jest już zajęta' })
      }
      throw err
    }
  }
}
```

- [ ] **Step 5: Create `apps/api/src/tenants/tenants.controller.ts`**

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common'
import { TenantsService } from './tenants.service.js'
import { SignupDto } from './dto/signup.dto.js'

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('slugs/check/:slug')
  async checkSlug(@Param('slug') slug: string): Promise<{ available: boolean }> {
    return { available: await this.tenants.isSlugAvailable(slug) }
  }

  @Post('auth/signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: SignupDto): Promise<{ jobId: string }> {
    return this.tenants.signup(dto)
  }
}
```

- [ ] **Step 6: Create `apps/api/src/tenants/tenants.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { TenantsService } from './tenants.service.js'
import { TenantsController } from './tenants.controller.js'

@Module({
  providers: [TenantsService],
  controllers: [TenantsController],
})
export class TenantsModule {}
```

- [ ] **Step 7: Register TenantsModule in `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { CommonModule } from './common/common.module.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'
import { TenantsModule } from './tenants/tenants.module.js'

@Module({ imports: [CommonModule, HealthModule, AuthModule, TenantsModule] })
export class AppModule {}
```

- [ ] **Step 8: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=tenants.service
```
Expected: 4 tests green.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/tenants apps/api/src/app.module.ts
git commit -m "feat(api): add TenantsModule — slug check and signup endpoint with P2002 conflict handling"
```

---

## Task 6: OutboxRelayService

**Files:**
- Create: `apps/api/src/outbox/outbox-relay.service.ts`
- Create: `apps/api/src/outbox/outbox-relay.service.spec.ts`
- Create: `apps/api/src/outbox/outbox.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/outbox/outbox-relay.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { of } from 'rxjs'
import { OutboxRelayService } from './outbox-relay.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

const pendingEvent = {
  id: 'evt-1',
  exchange: 'tenant.provision',
  routingKey: 'tenant.provision',
  payload: { jobId: 'job-1', tenantId: 'tenant-1' },
  publishedAt: null,
  createdAt: new Date(),
}

const mockPrisma = {
  outboxEvent: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
}

const mockClient = {
  emit: jest.fn().mockReturnValue(of(null)),
}

describe('OutboxRelayService', () => {
  let service: OutboxRelayService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxRelayService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'TENANT_PROVISION_CLIENT', useValue: mockClient },
      ],
    }).compile()
    service = module.get(OutboxRelayService)
    jest.clearAllMocks()
  })

  it('emits pending events to RabbitMQ and marks them published', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([pendingEvent])
    mockPrisma.outboxEvent.update.mockResolvedValue({ ...pendingEvent, publishedAt: new Date() })

    await service.publishPending()

    expect(mockClient.emit).toHaveBeenCalledWith('tenant.provision', {
      jobId: 'job-1',
      tenantId: 'tenant-1',
    })
    expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { publishedAt: expect.any(Date) as Date },
    })
  })

  it('does nothing when there are no pending events', async () => {
    mockPrisma.outboxEvent.findMany.mockResolvedValue([])
    await service.publishPending()
    expect(mockClient.emit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=outbox-relay
```

- [ ] **Step 3: Create `apps/api/src/outbox/outbox-relay.service.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('TENANT_PROVISION_CLIENT') private readonly client: ClientProxy,
  ) {}

  @Cron('*/5 * * * * *') // every 5 seconds
  async publishPending(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })

    for (const event of events) {
      try {
        await firstValueFrom(
          this.client.emit(event.routingKey, event.payload as Record<string, unknown>),
        )
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date() },
        })
      } catch (err) {
        this.logger.error({ err, eventId: event.id }, 'Failed to publish outbox event')
      }
    }
  }
}
```

- [ ] **Step 4: Create `apps/api/src/outbox/outbox.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { parseEnv } from '@hrobot/config'
import { OutboxRelayService } from './outbox-relay.service.js'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      {
        name: 'TENANT_PROVISION_CLIENT',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [parseEnv().RABBITMQ_URL],
            queue: 'tenant.provision',
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  providers: [OutboxRelayService],
})
export class OutboxModule {}
```

- [ ] **Step 5: Register OutboxModule in `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { CommonModule } from './common/common.module.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'
import { TenantsModule } from './tenants/tenants.module.js'
import { OutboxModule } from './outbox/outbox.module.js'

@Module({ imports: [CommonModule, HealthModule, AuthModule, TenantsModule, OutboxModule] })
export class AppModule {}
```

- [ ] **Step 6: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=outbox-relay
```
Expected: 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/outbox apps/api/src/app.module.ts
git commit -m "feat(api): add OutboxRelayService — 5s cron publishes pending outbox events to RabbitMQ"
```

---

## Task 7: ProvisioningModule — consumer, state machine, retry

**Files:**
- Create: `apps/api/src/provisioning/provisioning.service.ts`
- Create: `apps/api/src/provisioning/provisioning.service.spec.ts`
- Create: `apps/api/src/provisioning/provisioning.consumer.ts`
- Create: `apps/api/src/provisioning/provisioning.controller.ts`
- Create: `apps/api/src/provisioning/provisioning.module.ts`
- Modify: `apps/api/src/app.module.ts`

Steps in `ProvisioningService` are injected as interface implementations (one per class). Each step receives the job and runs idempotently. The service dispatches to the correct step based on `job.step`, handles errors, and re-enqueues with exponential backoff.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/provisioning/provisioning.service.spec.ts`:

```typescript
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { of } from 'rxjs'
import { ProvisioningService } from './provisioning.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { ProvisioningStep } from '@hrobot/shared'

const makeJob = (step: string, attemptCount = 0) => ({
  id: 'job-1',
  tenantId: 'tenant-1',
  step,
  attemptCount,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const mockSteps = {
  createDb: { execute: jest.fn() },
  runMigrations: { execute: jest.fn() },
  seed: { execute: jest.fn() },
  keycloakSetup: { execute: jest.fn() },
  done: { execute: jest.fn() },
}

const mockPrisma = {
  provisioningJob: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}

const mockClient = { emit: jest.fn().mockReturnValue(of(null)) }

describe('ProvisioningService', () => {
  let service: ProvisioningService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'TENANT_PROVISION_CLIENT', useValue: mockClient },
        { provide: 'CREATE_DB_STEP', useValue: mockSteps.createDb },
        { provide: 'RUN_MIGRATIONS_STEP', useValue: mockSteps.runMigrations },
        { provide: 'SEED_STEP', useValue: mockSteps.seed },
        { provide: 'KEYCLOAK_SETUP_STEP', useValue: mockSteps.keycloakSetup },
        { provide: 'DONE_STEP', useValue: mockSteps.done },
      ],
    }).compile()
    service = module.get(ProvisioningService)
    jest.useFakeTimers()
    jest.clearAllMocks()
  })

  afterEach(() => { jest.useRealTimers() })

  it('dispatches to CREATE_DB step when job.step is CREATE_DB', async () => {
    const job = makeJob(ProvisioningStep.CREATE_DB)
    mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
    mockSteps.createDb.execute.mockResolvedValue(undefined)

    await service.process({ jobId: 'job-1', tenantId: 'tenant-1' })

    expect(mockSteps.createDb.execute).toHaveBeenCalledWith(job)
    expect(mockSteps.runMigrations.execute).not.toHaveBeenCalled()
  })

  it('increments attemptCount and re-enqueues on step failure (attemptCount < 3)', async () => {
    const job = makeJob(ProvisioningStep.CREATE_DB, 0)
    mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
    mockPrisma.provisioningJob.update.mockResolvedValue({ ...job, attemptCount: 1 })
    mockSteps.createDb.execute.mockRejectedValue(new Error('DB error'))

    await service.process({ jobId: 'job-1', tenantId: 'tenant-1' })

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { attemptCount: 1, lastError: 'DB error' },
    })
    // Re-enqueue scheduled — advance past first delay
    jest.runAllTimers()
    expect(mockClient.emit).toHaveBeenCalledWith('tenant.provision', {
      jobId: 'job-1',
      tenantId: 'tenant-1',
    })
  })

  it('sets step=FAILED when attemptCount reaches 3', async () => {
    const job = makeJob(ProvisioningStep.CREATE_DB, 2)
    mockPrisma.provisioningJob.findUnique.mockResolvedValue(job)
    mockPrisma.provisioningJob.update.mockResolvedValue({})
    mockSteps.createDb.execute.mockRejectedValue(new Error('still broken'))

    await service.process({ jobId: 'job-1', tenantId: 'tenant-1' })

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        step: ProvisioningStep.FAILED,
        lastError: 'still broken',
        attemptCount: 3,
      },
    })
    jest.runAllTimers()
    expect(mockClient.emit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=provisioning.service
```

- [ ] **Step 3: Create `apps/api/src/provisioning/provisioning.service.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom } from 'rxjs'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

export interface ProvisioningStepHandler {
  execute(job: {
    id: string
    tenantId: string
    step: string
    attemptCount: number
  }): Promise<void>
}

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('TENANT_PROVISION_CLIENT') private readonly client: ClientProxy,
    @Inject('CREATE_DB_STEP') private readonly createDb: ProvisioningStepHandler,
    @Inject('RUN_MIGRATIONS_STEP') private readonly runMigrations: ProvisioningStepHandler,
    @Inject('SEED_STEP') private readonly seed: ProvisioningStepHandler,
    @Inject('KEYCLOAK_SETUP_STEP') private readonly keycloakSetup: ProvisioningStepHandler,
    @Inject('DONE_STEP') private readonly done: ProvisioningStepHandler,
  ) {}

  async process(msg: { jobId: string; tenantId: string }): Promise<void> {
    const job = await this.prisma.provisioningJob.findUnique({ where: { id: msg.jobId } })
    if (!job) {
      this.logger.warn({ jobId: msg.jobId }, 'Provisioning job not found — skipping')
      return
    }

    const stepMap: Record<string, ProvisioningStepHandler> = {
      [ProvisioningStep.CREATE_DB]: this.createDb,
      [ProvisioningStep.RUN_MIGRATIONS]: this.runMigrations,
      [ProvisioningStep.SEED]: this.seed,
      [ProvisioningStep.KEYCLOAK_SETUP]: this.keycloakSetup,
      [ProvisioningStep.DONE]: this.done,
    }

    const handler = stepMap[job.step]
    if (!handler) {
      this.logger.warn({ step: job.step }, 'No handler for step — skipping')
      return
    }

    try {
      await handler.execute(job)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const nextAttempt = job.attemptCount + 1

      if (nextAttempt >= 3) {
        this.logger.error({ jobId: job.id, err }, 'Provisioning permanently failed after 3 attempts')
        await this.prisma.provisioningJob.update({
          where: { id: job.id },
          data: { step: ProvisioningStep.FAILED, lastError: message, attemptCount: nextAttempt },
        })
        // Ops alert — in production replace with Slack/email webhook
        this.logger.error({ tenantId: job.tenantId }, 'ALERT: tenant provisioning failed permanently')
        return
      }

      await this.prisma.provisioningJob.update({
        where: { id: job.id },
        data: { attemptCount: nextAttempt, lastError: message },
      })

      const delayMs = RETRY_DELAYS_MS[job.attemptCount] ?? 600_000
      this.logger.warn({ jobId: job.id, delayMs }, 'Scheduling retry')
      setTimeout(() => {
        void firstValueFrom(
          this.client.emit('tenant.provision', { jobId: job.id, tenantId: job.tenantId }),
        )
      }, delayMs)
    }
  }
}
```

- [ ] **Step 4: Create `apps/api/src/provisioning/provisioning.consumer.ts`**

```typescript
import { Controller } from '@nestjs/common'
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices'
import { ProvisioningService } from './provisioning.service.js'

@Controller()
export class ProvisioningConsumer {
  constructor(private readonly provisioning: ProvisioningService) {}

  @MessagePattern('tenant.provision')
  async handle(
    @Payload() msg: { jobId: string; tenantId: string },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    await this.provisioning.process(msg)
    const channel = context.getChannelRef() as { ack(msg: object): void }
    channel.ack(context.getMessage() as object)
  }
}
```

- [ ] **Step 5: Create `apps/api/src/provisioning/provisioning.controller.ts`**

```typescript
import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Controller('provision')
export class ProvisioningController {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  @Get('status/:jobId')
  async status(@Param('jobId') jobId: string): Promise<{
    step: string
    attemptCount: number
    done: boolean
    failed: boolean
    errorCode: string | null
  }> {
    const job = await this.prisma.provisioningJob.findUnique({ where: { id: jobId } })
    if (!job) throw new NotFoundException('Provisioning job not found')
    // FIX-H1: never return raw lastError here. This endpoint is unauthenticated and
    // lastError can contain the tenant DATABASE_URL + password (prisma stderr).
    const failed = job.step === 'FAILED' // matches ProvisioningStep.FAILED
    return {
      step: job.step,
      attemptCount: job.attemptCount,
      done: failed || job.step === 'DONE',
      failed,
      errorCode: failed ? 'PROVISIONING_FAILED' : null,
    }
  }
}
```

- [ ] **Step 6: Create placeholder step classes** (real implementations in Tasks 8–10)

Create `apps/api/src/provisioning/steps/create-db.step.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

@Injectable()
export class CreateDbStep implements ProvisioningStepHandler {
  async execute(_job: { id: string; tenantId: string }): Promise<void> {
    throw new Error('CreateDbStep not yet implemented')
  }
}
```

Repeat the same placeholder pattern for `run-migrations.step.ts`, `seed.step.ts`, `keycloak-setup.step.ts`, and `done.step.ts` — same structure, different class name and error message.

- [ ] **Step 7: Create `apps/api/src/provisioning/provisioning.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { parseEnv } from '@hrobot/config'
import { ProvisioningService } from './provisioning.service.js'
import { ProvisioningConsumer } from './provisioning.consumer.js'
import { ProvisioningController } from './provisioning.controller.js'
import { CreateDbStep } from './steps/create-db.step.js'
import { RunMigrationsStep } from './steps/run-migrations.step.js'
import { SeedStep } from './steps/seed.step.js'
import { KeycloakSetupStep } from './steps/keycloak-setup.step.js'
import { DoneStep } from './steps/done.step.js'

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'TENANT_PROVISION_CLIENT',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [parseEnv().RABBITMQ_URL],
            queue: 'tenant.provision',
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  providers: [
    ProvisioningService,
    ProvisioningConsumer,
    { provide: 'CREATE_DB_STEP', useClass: CreateDbStep },
    { provide: 'RUN_MIGRATIONS_STEP', useClass: RunMigrationsStep },
    { provide: 'SEED_STEP', useClass: SeedStep },
    { provide: 'KEYCLOAK_SETUP_STEP', useClass: KeycloakSetupStep },
    { provide: 'DONE_STEP', useClass: DoneStep },
  ],
  controllers: [ProvisioningController],
})
export class ProvisioningModule {}
```

- [ ] **Step 8: Register ProvisioningModule in `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { CommonModule } from './common/common.module.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'
import { TenantsModule } from './tenants/tenants.module.js'
import { OutboxModule } from './outbox/outbox.module.js'
import { ProvisioningModule } from './provisioning/provisioning.module.js'

@Module({
  imports: [CommonModule, HealthModule, AuthModule, TenantsModule, OutboxModule, ProvisioningModule],
})
export class AppModule {}
```

- [ ] **Step 9: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=provisioning.service
```
Expected: 3 tests green.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/provisioning apps/api/src/app.module.ts
git commit -m "feat(api): add ProvisioningModule — consumer, state machine, retry/backoff, status endpoint"
```

---

## Task 8: CREATE_DB step

**Files:**
- Modify: `apps/api/src/provisioning/steps/create-db.step.ts`

The step connects to Postgres as superuser, creates a dedicated user and database for the tenant, encrypts the connection URL, stores it in `tenants.db_url`, and advances the job to `RUN_MIGRATIONS`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/provisioning/steps/create-db.step.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { CreateDbStep } from './create-db.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const mockPg = { query: jest.fn() }

const testKey = Buffer.from('a'.repeat(64), 'hex')
const encryption = new EncryptionService(testKey)

const job = {
  id: 'job-1',
  tenantId: 'tenant-1',
  step: ProvisioningStep.CREATE_DB,
  attemptCount: 0,
}

const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  metadata: { adminEmail: 'admin@acme.com' },
}

describe('CreateDbStep', () => {
  let step: CreateDbStep

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateDbStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'SUPERUSER_PG_CLIENT', useValue: mockPg },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile()
    step = module.get(CreateDbStep)
    jest.clearAllMocks()
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue(tenant)
    mockPg.query.mockResolvedValue({ rows: [] })
    mockPrisma.tenant.update.mockResolvedValue({})
    mockPrisma.provisioningJob.update.mockResolvedValue({})
  })

  it('executes CREATE USER and CREATE DATABASE SQL', async () => {
    await step.execute(job)
    expect(mockPg.query).toHaveBeenCalledTimes(2)
    const [createUser, createDb] = mockPg.query.mock.calls as [[string], [string]]
    expect(createUser[0]).toMatch(/CREATE USER/)
    expect(createDb[0]).toMatch(/CREATE DATABASE/)
  })

  it('stores an encrypted db_url in tenants and advances step to RUN_MIGRATIONS', async () => {
    await step.execute(job)

    const tenantUpdateCall = mockPrisma.tenant.update.mock.calls[0]?.[0] as {
      data: { dbUrl: string }
    }
    const encryptedUrl = tenantUpdateCall.data.dbUrl
    // Must be base64 (encrypted), not plaintext
    expect(encryptedUrl).not.toMatch(/^postgresql:\/\//)
    // Must decrypt back to a valid URL
    const decrypted = encryption.decrypt(encryptedUrl)
    expect(decrypted).toMatch(/^postgresql:\/\//)

    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.RUN_MIGRATIONS },
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=create-db.step
```

- [ ] **Step 3: Implement `apps/api/src/provisioning/steps/create-db.step.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type { Client as PgClient } from 'pg'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

@Injectable()
export class CreateDbStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(CreateDbStep.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('SUPERUSER_PG_CLIENT') private readonly pg: PgClient,
    private readonly encryption: EncryptionService,
  ) {}

  async execute(job: { id: string; tenantId: string }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    const shortId = tenant.id.replace(/-/g, '').slice(0, 8)
    const dbName = `hrobot_t_${shortId}`
    const dbUser = `hu_${shortId}`
    const dbPassword = randomBytes(24).toString('base64url')

    this.logger.log({ tenantId: tenant.id, dbName }, 'Creating tenant database')

    await this.pg.query(
      `CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`,
    )
    await this.pg.query(
      `CREATE DATABASE "${dbName}" OWNER "${dbUser}"`,
    )

    // Extract host/port from superuser URL for the tenant connection string
    const superuserUrl = new URL(process.env['POSTGRES_SUPERUSER_URL'] ?? '')
    const host = superuserUrl.hostname
    const port = superuserUrl.port || '5432'
    const dbUrl = `postgresql://${dbUser}:${dbPassword}@${host}:${port}/${dbName}`
    const encryptedUrl = this.encryption.encrypt(dbUrl)

    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: { dbUrl: encryptedUrl },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.RUN_MIGRATIONS },
    })
  }
}
```

- [ ] **Step 4: Provide `SUPERUSER_PG_CLIENT` and `EncryptionService` in ProvisioningModule**

Update `apps/api/src/provisioning/provisioning.module.ts` — add providers:

```typescript
import { Client as PgClient } from 'pg'
import { EncryptionService } from '@hrobot/shared'
import { parseEnv } from '@hrobot/config'

// Inside @Module providers array, add:
{
  provide: 'SUPERUSER_PG_CLIENT',
  useFactory: async (): Promise<PgClient> => {
    const client = new PgClient({ connectionString: parseEnv().POSTGRES_SUPERUSER_URL })
    await client.connect()
    return client
  },
},
{
  provide: EncryptionService,
  useFactory: (): EncryptionService => {
    const key = Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')
    return new EncryptionService(key)
  },
},
```

Full updated `provisioning.module.ts`:

```typescript
import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { Client as PgClient } from 'pg'
import { parseEnv } from '@hrobot/config'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningService } from './provisioning.service.js'
import { ProvisioningConsumer } from './provisioning.consumer.js'
import { ProvisioningController } from './provisioning.controller.js'
import { CreateDbStep } from './steps/create-db.step.js'
import { RunMigrationsStep } from './steps/run-migrations.step.js'
import { SeedStep } from './steps/seed.step.js'
import { KeycloakSetupStep } from './steps/keycloak-setup.step.js'
import { DoneStep } from './steps/done.step.js'

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'TENANT_PROVISION_CLIENT',
        useFactory: () => ({
          transport: Transport.RMQ,
          options: {
            urls: [parseEnv().RABBITMQ_URL],
            queue: 'tenant.provision',
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  providers: [
    ProvisioningService,
    ProvisioningConsumer,
    {
      provide: 'SUPERUSER_PG_CLIENT',
      useFactory: async (): Promise<PgClient> => {
        const client = new PgClient({ connectionString: parseEnv().POSTGRES_SUPERUSER_URL })
        await client.connect()
        return client
      },
    },
    {
      provide: EncryptionService,
      useFactory: (): EncryptionService =>
        new EncryptionService(Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')),
    },
    { provide: 'CREATE_DB_STEP', useClass: CreateDbStep },
    { provide: 'RUN_MIGRATIONS_STEP', useClass: RunMigrationsStep },
    { provide: 'SEED_STEP', useClass: SeedStep },
    { provide: 'KEYCLOAK_SETUP_STEP', useClass: KeycloakSetupStep },
    { provide: 'DONE_STEP', useClass: DoneStep },
  ],
  controllers: [ProvisioningController],
})
export class ProvisioningModule {}
```

- [ ] **Step 5: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=create-db.step
```
Expected: 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/provisioning/steps/create-db.step.ts apps/api/src/provisioning/steps/create-db.step.spec.ts apps/api/src/provisioning/provisioning.module.ts
git commit -m "feat(api): implement CREATE_DB provisioning step with encrypted db_url storage"
```

---

## Task 9: RUN_MIGRATIONS + SEED steps

**Files:**
- Modify: `apps/api/src/provisioning/steps/run-migrations.step.ts`
- Modify: `apps/api/src/provisioning/steps/seed.step.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/provisioning/steps/run-migrations.step.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { RunMigrationsStep } from './run-migrations.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'

const testKey = Buffer.from('a'.repeat(64), 'hex')
const encryption = new EncryptionService(testKey)

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const job = { id: 'job-1', tenantId: 'tenant-1' }

describe('RunMigrationsStep', () => {
  let step: RunMigrationsStep
  let mockSpawn: jest.Mock

  beforeEach(async () => {
    mockSpawn = jest.fn().mockReturnValue({ status: 0, stderr: '' })
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunMigrationsStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: 'SPAWN_SYNC', useValue: mockSpawn },
      ],
    }).compile()
    step = module.get(RunMigrationsStep)
    jest.clearAllMocks()
    mockPrisma.provisioningJob.update.mockResolvedValue({})
  })

  it('calls prisma migrate deploy with the decrypted DATABASE_URL', async () => {
    const plainUrl = 'postgresql://hu_abc:pw@localhost:5433/hrobot_t_abc'
    const encryptedUrl = encryption.encrypt(plainUrl)
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ dbUrl: encryptedUrl })

    await step.execute(job)

    expect(mockSpawn).toHaveBeenCalledWith(
      'pnpm',
      ['prisma', 'migrate', 'deploy', '--schema=packages/db/prisma/tenant/schema.prisma'],
      expect.objectContaining({
        env: expect.objectContaining({ DATABASE_URL: plainUrl }) as Record<string, string>,
      }),
    )
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.SEED },
    })
  })

  it('throws when spawnSync returns non-zero exit code', async () => {
    const plainUrl = 'postgresql://hu_abc:pw@localhost:5433/hrobot_t_abc'
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({
      dbUrl: encryption.encrypt(plainUrl),
    })
    mockSpawn.mockReturnValue({ status: 1, stderr: 'migration error' })

    await expect(step.execute(job)).rejects.toThrow('migration error')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=run-migrations.step
```

- [ ] **Step 3: Implement `apps/api/src/provisioning/steps/run-migrations.step.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

type SpawnFn = typeof spawnSync

@Injectable()
export class RunMigrationsStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(RunMigrationsStep.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
    @Inject('SPAWN_SYNC') private readonly spawn: SpawnFn,
  ) {}

  async execute(job: { id: string; tenantId: string }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    const dbUrl = this.encryption.decrypt(tenant.dbUrl!)
    this.logger.log({ tenantId: job.tenantId }, 'Running tenant migrations')

    const result: SpawnSyncReturns<Buffer> = this.spawn(
      'pnpm',
      ['prisma', 'migrate', 'deploy', '--schema=packages/db/prisma/tenant/schema.prisma'],
      {
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
        encoding: 'buffer',
      },
    )

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? 'unknown error'
      throw new Error(stderr)
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.SEED },
    })
  }
}
```

- [ ] **Step 4: Add `SPAWN_SYNC` provider to `provisioning.module.ts`**

Add to the providers array in `provisioning.module.ts`:

```typescript
import { spawnSync } from 'node:child_process'

// In providers:
{ provide: 'SPAWN_SYNC', useValue: spawnSync },
```

- [ ] **Step 5: Write failing test for SeedStep**

Create `apps/api/src/provisioning/steps/seed.step.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { SeedStep } from './seed.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'

const testKey = Buffer.from('a'.repeat(64), 'hex')
const encryption = new EncryptionService(testKey)

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

const mockTenantClient = {
  organizationalUnit: { create: jest.fn() },
  $disconnect: jest.fn(),
}

const job = { id: 'job-1', tenantId: 'tenant-1' }

describe('SeedStep', () => {
  let step: SeedStep

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeedStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: 'TENANT_CLIENT_FACTORY', useValue: (url: string) => { void url; return mockTenantClient } },
      ],
    }).compile()
    step = module.get(SeedStep)
    jest.clearAllMocks()
    mockPrisma.provisioningJob.update.mockResolvedValue({})
    mockTenantClient.organizationalUnit.create.mockResolvedValue({ id: 'unit-1' })
    mockTenantClient.$disconnect.mockResolvedValue(undefined)
  })

  it('creates root OrganizationalUnit "Cała firma" and advances to KEYCLOAK_SETUP', async () => {
    const plainUrl = 'postgresql://u:p@localhost:5433/db'
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ dbUrl: encryption.encrypt(plainUrl) })

    await step.execute(job)

    expect(mockTenantClient.organizationalUnit.create).toHaveBeenCalledWith({
      data: { name: 'Cała firma', parentId: null },
    })
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.KEYCLOAK_SETUP },
    })
    expect(mockTenantClient.$disconnect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Implement `apps/api/src/provisioning/steps/seed.step.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep, TenantClient } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

// Re-export TenantClient type from @hrobot/db for clarity
import { TenantClient as TenantPrismaClient } from '@hrobot/db'

type TenantClientFactory = (dbUrl: string) => TenantPrismaClient & { $disconnect(): Promise<void> }

@Injectable()
export class SeedStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(SeedStep.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
    @Inject('TENANT_CLIENT_FACTORY') private readonly clientFactory: TenantClientFactory,
  ) {}

  async execute(job: { id: string; tenantId: string }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    const dbUrl = this.encryption.decrypt(tenant.dbUrl!)
    const client = this.clientFactory(dbUrl)

    try {
      this.logger.log({ tenantId: job.tenantId }, 'Seeding tenant database')
      await client.organizationalUnit.create({
        data: { name: 'Cała firma', parentId: null },
      })
    } finally {
      await client.$disconnect()
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.KEYCLOAK_SETUP },
    })
  }
}
```

- [ ] **Step 7: Add `TENANT_CLIENT_FACTORY` provider to `provisioning.module.ts`**

```typescript
import { TenantClient } from '@hrobot/db'

// In providers:
{
  provide: 'TENANT_CLIENT_FACTORY',
  useValue: (datasourceUrl: string) => new TenantClient({ datasourceUrl }),
},
```

- [ ] **Step 8: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern="(run-migrations|seed).step"
```
Expected: 3 tests green.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/provisioning/steps/run-migrations.step.ts apps/api/src/provisioning/steps/run-migrations.step.spec.ts apps/api/src/provisioning/steps/seed.step.ts apps/api/src/provisioning/steps/seed.step.spec.ts apps/api/src/provisioning/provisioning.module.ts
git commit -m "feat(api): implement RUN_MIGRATIONS and SEED provisioning steps"
```

---

## Task 10: KEYCLOAK_SETUP + DONE steps

**Files:**
- Modify: `apps/api/src/provisioning/steps/keycloak-setup.step.ts`
- Modify: `apps/api/src/provisioning/steps/done.step.ts`

- [ ] **Step 1: Write failing test for KeycloakSetupStep**

Create `apps/api/src/provisioning/steps/keycloak-setup.step.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { KeycloakSetupStep } from './keycloak-setup.step.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { ProvisioningStep } from '@hrobot/shared'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  provisioningJob: { update: jest.fn() },
}

let fetchCalls: { url: string; method: string }[]
const mockFetch = jest.fn()

const job = { id: 'job-1', tenantId: 'tenant-1' }
const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  metadata: { adminEmail: 'admin@acme.com' },
}

describe('KeycloakSetupStep', () => {
  let step: KeycloakSetupStep

  beforeEach(async () => {
    fetchCalls = []
    let callIndex = 0
    mockFetch.mockImplementation((url: string, opts: { method: string }) => {
      fetchCalls.push({ url: String(url), method: opts.method })
      callIndex++
      // Token response
      if (callIndex === 1) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'tok' }) })
      // Create realm
      if (callIndex === 2) return Promise.resolve({ ok: true, json: async () => ({}) })
      // Create client
      if (callIndex === 3) return Promise.resolve({ ok: true, json: async () => ({}) })
      // Create user — returns Location header
      if (callIndex === 4) return Promise.resolve({
        ok: true,
        headers: { get: () => 'http://kc/admin/realms/hrobot-acme/users/user-uuid-1' },
        json: async () => ({}),
      })
      // Credential reset email
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakSetupStep,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: 'FETCH', useValue: mockFetch },
      ],
    }).compile()
    step = module.get(KeycloakSetupStep)
    jest.clearAllMocks()
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue(tenant)
    mockPrisma.tenant.update.mockResolvedValue({})
    mockPrisma.provisioningJob.update.mockResolvedValue({})
  })

  it('creates realm, client, admin user and sends credential-reset email', async () => {
    await step.execute(job)

    // 5 fetch calls: token + realm + client + user + credential email
    expect(mockFetch).toHaveBeenCalledTimes(5)
    expect(fetchCalls[1]?.url).toMatch(/\/admin\/realms$/)
    expect(fetchCalls[2]?.url).toMatch(/hrobot-acme\/clients$/)
    expect(fetchCalls[3]?.url).toMatch(/hrobot-acme\/users$/)
    expect(fetchCalls[4]?.url).toMatch(/execute-actions-email$/)
  })

  it('stores realmName + keycloakClientId in tenants.metadata and advances to DONE', async () => {
    await step.execute(job)

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ realmName: 'hrobot-acme' }) as object,
        }) as object,
      }),
    )
    expect(mockPrisma.provisioningJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { step: ProvisioningStep.DONE },
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=keycloak-setup.step
```

- [ ] **Step 3: Implement `apps/api/src/provisioning/steps/keycloak-setup.step.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { parseEnv } from '@hrobot/config'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

type FetchFn = typeof fetch

@Injectable()
export class KeycloakSetupStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(KeycloakSetupStep.name)
  private readonly keycloakUrl = parseEnv().KEYCLOAK_URL
  private readonly adminPassword = parseEnv().KEYCLOAK_ADMIN_CLIENT_SECRET

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('FETCH') private readonly fetchFn: FetchFn,
  ) {}

  private async getAdminToken(): Promise<string> {
    const resp = await this.fetchFn(
      `${this.keycloakUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: 'admin',
          password: this.adminPassword,
        }).toString(),
      },
    )
    const data = await resp.json() as { access_token: string }
    return data.access_token
  }

  async execute(job: { id: string; tenantId: string }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })
    const meta = tenant.metadata as Record<string, unknown>
    const adminEmail = String(meta['adminEmail'] ?? '')
    const realmName = `hrobot-${tenant.slug}`
    const adminBase = `${this.keycloakUrl}/admin/realms`
    const token = await this.getAdminToken()

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    // 1. Create realm
    await this.fetchFn(`${adminBase}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        realm: realmName,
        enabled: true,
        accessTokenLifespan: 300,      // 5 min (RODO)
        ssoSessionMaxLifespan: 36000,  // 10 h
      }),
    })

    // 2. Create hrobot-web client
    await this.fetchFn(`${adminBase}/${realmName}/clients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientId: 'hrobot-web',
        redirectUris: [`https://${tenant.slug}.hrobot.ai/*`],
        webOrigins: [`https://${tenant.slug}.hrobot.ai`],
        publicClient: true,
      }),
    })

    // 3. Create initial ADMIN_KLIENTA user (temporary password — Keycloak forces change)
    const tempPassword = randomBytes(12).toString('base64url')
    const createUserResp = await this.fetchFn(`${adminBase}/${realmName}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: adminEmail,
        email: adminEmail,
        enabled: true,
        credentials: [{ type: 'password', value: tempPassword, temporary: true }],
      }),
    })
    const locationHeader = (createUserResp.headers as { get(name: string): string | null }).get('Location') ?? ''
    const userId = locationHeader.split('/').pop() ?? ''

    // 4. Trigger credential-reset email
    await this.fetchFn(`${adminBase}/${realmName}/users/${userId}/execute-actions-email`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(['UPDATE_PASSWORD']),
    })

    this.logger.log({ tenantId: job.tenantId, realmName }, 'Keycloak realm provisioned')

    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: {
        metadata: { ...meta, realmName, keycloakClientId: 'hrobot-web' },
      },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.DONE },
    })
  }
}
```

- [ ] **Step 4: Implement `apps/api/src/provisioning/steps/done.step.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

@Injectable()
export class DoneStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(DoneStep.name)

  constructor(private readonly prisma: ControlPlanePrismaService) {}

  async execute(job: { id: string; tenantId: string }): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: { status: TenantStatus.ACTIVE, provisionedAt: new Date() },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: 'DONE' },
    })

    this.logger.log({ tenantId: job.tenantId }, 'Tenant provisioned and ACTIVE')
  }
}
```

- [ ] **Step 5: Add `FETCH` provider to `provisioning.module.ts`**

Add to the providers array:

```typescript
{ provide: 'FETCH', useValue: fetch },
```

- [ ] **Step 6: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=keycloak-setup.step
```
Expected: 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/provisioning/steps/keycloak-setup.step.ts apps/api/src/provisioning/steps/keycloak-setup.step.spec.ts apps/api/src/provisioning/steps/done.step.ts apps/api/src/provisioning/provisioning.module.ts
git commit -m "feat(api): implement KEYCLOAK_SETUP and DONE provisioning steps"
```

---

## Task 11: Rate limiting + Pino logging + Prometheus metrics

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/tenants/tenants.controller.ts`
- Modify: `apps/api/src/provisioning/provisioning.controller.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Wire Pino logging in `apps/api/src/app.module.ts`**

Replace `app.module.ts` with:

```typescript
import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import { ThrottlerModule } from '@nestjs/throttler'
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { CommonModule } from './common/common.module.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'
import { TenantsModule } from './tenants/tenants.module.js'
import { OutboxModule } from './outbox/outbox.module.js'
import { ProvisioningModule } from './provisioning/provisioning.module.js'
import { RedisService } from './common/redis/redis.service.js'

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ['req.headers.authorization'],
        formatters: { level: (label) => ({ level: label }) },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }], // default; overridden per-endpoint
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    CommonModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    OutboxModule,
    ProvisioningModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Apply per-endpoint rate limits in `tenants.controller.ts`**

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { TenantsService } from './tenants.service.js'
import { SignupDto } from './dto/signup.dto.js'

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * 10 requests per minute per IP — prevents slug enumeration.
   * ttl is in milliseconds for @nestjs/throttler v6.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('slugs/check/:slug')
  async checkSlug(@Param('slug') slug: string): Promise<{ available: boolean }> {
    return { available: await this.tenants.isSlugAvailable(slug) }
  }

  @Post('auth/signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: SignupDto): Promise<{ jobId: string }> {
    return this.tenants.signup(dto)
  }
}
```

- [ ] **Step 3: Apply rate limit in `provisioning.controller.ts`**

```typescript
import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Controller('provision')
export class ProvisioningController {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  /**
   * 30 requests per minute per IP — jobId is a secret UUID, still cap polling abuse.
   */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('status/:jobId')
  async status(@Param('jobId') jobId: string): Promise<{
    step: string
    attemptCount: number
    done: boolean
    failed: boolean
    errorCode: string | null
  }> {
    const job = await this.prisma.provisioningJob.findUnique({ where: { id: jobId } })
    if (!job) throw new NotFoundException('Provisioning job not found')
    // FIX-H1: never return raw lastError here. This endpoint is unauthenticated and
    // lastError can contain the tenant DATABASE_URL + password (prisma stderr).
    const failed = job.step === 'FAILED' // matches ProvisioningStep.FAILED
    return {
      step: job.step,
      attemptCount: job.attemptCount,
      done: failed || job.step === 'DONE',
      failed,
      errorCode: failed ? 'PROVISIONING_FAILED' : null,
    }
  }
}
```

- [ ] **Step 4: Apply `ThrottlerGuard` globally in `main.ts`**

Add to `bootstrap()` after `app.useGlobalPipes`:

```typescript
import { ThrottlerGuard } from '@nestjs/throttler'
import { Reflector } from '@nestjs/core'

// After useGlobalPipes:
const reflector = app.get(Reflector)
app.useGlobalGuards(new ThrottlerGuard({}, app.get('THROTTLER:MODULE_OPTIONS'), reflector))
```

Actually, the correct NestJS pattern for global ThrottlerGuard with DI is via APP_GUARD. Replace the manual `useGlobalGuards` call with a provider in `app.module.ts`. Add to the `@Module` decorator:

```typescript
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard } from '@nestjs/throttler'

// Add to providers array in AppModule:
providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
```

Full final `app.module.ts`:

```typescript
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis'
import { PrometheusModule } from '@willsoto/nestjs-prometheus'
import { CommonModule } from './common/common.module.js'
import { HealthModule } from './health/health.module.js'
import { AuthModule } from './auth/auth.module.js'
import { TenantsModule } from './tenants/tenants.module.js'
import { OutboxModule } from './outbox/outbox.module.js'
import { ProvisioningModule } from './provisioning/provisioning.module.js'
import { RedisService } from './common/redis/redis.service.js'

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ['req.headers.authorization'],
        formatters: { level: (label) => ({ level: label }) },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    CommonModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    OutboxModule,
    ProvisioningModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

- [ ] **Step 5: Verify build**

```
cd apps/api && pnpm build
```
Expected: compiles without errors.

- [ ] **Step 6: Run all apps/api tests**

```
cd apps/api && pnpm test
```
Expected: all tests green (ControlPlanePrismaService × 1, AuthService × 3, TenantsService × 4, OutboxRelayService × 2, ProvisioningService × 3, CreateDbStep × 2, RunMigrationsStep × 2, SeedStep × 1, KeycloakSetupStep × 2 = **20 tests green**).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/tenants/tenants.controller.ts apps/api/src/provisioning/provisioning.controller.ts
git commit -m "feat(api): wire Pino logging, Redis-backed rate limiting (10/min slug-check, 30/min status), Prometheus metrics"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered by |
|------------------|-----------|
| POST /api/auth/signup → 202 + jobId | Task 5 |
| Slug uniqueness race → 409 "Ta nazwa jest już zajęta" | Task 5 |
| Outbox relay: publish pending every 5s | Task 6 |
| Provisioning: CREATE_DB → encrypted db_url | Task 8 |
| Provisioning: RUN_MIGRATIONS (prisma migrate deploy) | Task 9 |
| Provisioning: SEED (root org unit "Cała firma") | Task 9 |
| Provisioning: KEYCLOAK_SETUP (realm + client + user + email) | Task 10 |
| Provisioning: DONE → status=ACTIVE | Task 10 |
| Retry: 3 attempts, exponential backoff 30s/2min/10min | Task 7 |
| Permanent failure → step=FAILED + ops alert log | Task 7 |
| GET /api/provision/status/:jobId (no auth, rate limited 30/min) | Tasks 7 + 11 |
| GET /api/slugs/check/:slug (no auth, rate limited 10/min) | Tasks 5 + 11 |
| GET /api/auth/global/login (bcrypt, JWT) | Task 4 |
| GET /health/live + /health/ready (DB + Redis) | Task 3 |
| Pino structured JSON logging | Task 11 |
| Prometheus /metrics | Task 11 |
| Rate limiting via Redis (survives pod restarts) | Task 11 |

**Gaps fixed:** The `TENANT_CLIENT_FACTORY` provider in ProvisioningModule is required by SeedStep — included in Task 9. The `SPAWN_SYNC` provider is injected rather than called directly — makes RunMigrationsStep fully unit-testable without forking processes. `FETCH` is injected into KeycloakSetupStep for the same reason.

**Type consistency check:**
- `ProvisioningStepHandler.execute(job)` — `job` type includes `{ id, tenantId, step, attemptCount }` defined in Task 7; Tasks 8–10 use the same type ✅
- `ProvisioningStep` enum values (`CREATE_DB`, `RUN_MIGRATIONS`, etc.) imported from `@hrobot/shared` throughout ✅
- `TenantStatus.PENDING` / `TenantStatus.ACTIVE` from `@hrobot/shared` ✅

---

Plan complete and saved to `docs/superpowers/plans/2026-05-27-foundation-02-nestjs-control-plane.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review after each, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

---

<!-- ════════════════════════════════════════════════════════════════════ -->
<!-- /autoplan REVIEW — generated 2026-05-31. Mode: SELECTIVE EXPANSION.   -->
<!-- Premise gate: user chose HOLD & BULLETPROOF (premises held).          -->
<!-- ════════════════════════════════════════════════════════════════════ -->

# /autoplan Review Report — Plan 2 (Control Plane)

## Phase 1 — CEO Review

### Premises (held by user at premise gate; challenge carried to final gate)
P1 DB-per-tenant · P2 Keycloak realm-per-tenant · P3 self-hosted Keycloak · P4 bespoke
outbox+RabbitMQ+setTimeout retry · P5 foundation excludes billing/DR/deprovision.
Both reviewers (Claude full; Codex partial, sandbox-blocked) flagged P1-P5 as asserted,
not argued; P2 (realm cliff) and P4 (non-durable retry) rated highest-risk at ~1k tenants.

### What already exists (Plan 1 — reused, no rebuild)
`@hrobot/shared` EncryptionService (AES-256-GCM), ProvisioningStep/TenantStatus enums;
`@hrobot/db` ControlPlaneClient/TenantClient/TenantPrismaManager; `@hrobot/config` parseEnv.
DRY smell: parseEnv() called in ~8 sites instead of injected once.

### Dream-state delta
Plan 2 delivers the control plane + provisioning engine. Gap to 12-month ideal: durable
retries, DR/backup, DEPROVISION/RODO erasure, billing gate, and an auth/isolation model
that does not hit a cliff at ~1k tenants.

### Error & Rescue Registry
| Codepath | Failure | Rescued? | Fix (decision) |
|---|---|---|---|
| signup tx | control-plane DB down | N (GAP) | accept: try→503 |
| OutboxRelay | two pods run cron | N (GAP) | accept: FOR UPDATE SKIP LOCKED claim |
| ProvisioningSvc | pod dies mid setTimeout wait | N (GAP) | accept: persist next_attempt_at + poller |
| ProvisioningConsumer | acks even on caught failure | N (GAP) | accept: rely on poller, no blind ack |
| CreateDbStep | CREATE USER when role exists (retry) | N (GAP) | accept: existence-guard / idempotent |
| CreateDbStep | 8-hex shortId collision | N (GAP) | accept: use full tenant.id |
| RunMigrationsStep | stderr leaks DATABASE_URL+password | N (GAP) | accept: sanitize lastError |
| KeycloakSetupStep | no resp.ok checks anywhere | N (GAP) | accept: check every response |
| KeycloakSetupStep | realm/user exists on retry (409 swallowed) | N (GAP) | accept: GET-or-create idempotent |
| KeycloakSetupStep | user 409 → userId='' → reset email 404 | N (GAP) | accept: tenant ACTIVE but admin locked out — fix |

### Failure Modes Registry (critical gaps flagged ⚠)
| # | Failure mode | Severity | Status |
|---|---|---|---|
| F1 | Retry uses in-process setTimeout → lost on pod restart/deploy | ⚠ Critical | accept (orchestrator B / RMQ delayed-exchange) |
| F2 | Provisioning steps not idempotent → retry/replay corrupts | ⚠ Critical | accept (guard each step) |
| F3 | Keycloak step has zero response checks → silent ACTIVE-but-broken tenant | ⚠ Critical | accept |
| F4 | Credential leak via unauthenticated status endpoint (prisma stderr) | ⚠ High | accept (sanitize) |
| F5 | Multi-pod outbox double-publish (no claim) | High | accept (SKIP LOCKED) |
| F6 | spawnSync blocks event loop / stalls HTTP+AMQP | High | accept (async spawn / worker — TASTE) |
| F7 | No compensation → orphaned DB/user/realm on permanent failure | High | accept (implement or document + sweep) |
| F8 | Single pg.Client (no pool/reconnect) → CREATE_DB dies on conn drop | Med | accept (Pool) |
| F9 | No DR/backup; no DEPROVISION/RODO erasure | ⚠ High | propose at gate (P5 held) |
| F10 | Realm-per-tenant cliff + slug coupling, no rename | High | USER CHALLENGE → gate |

### NOT in scope (deferred — see TODOS.md)
- Architecture pivots (schema-per-tenant, single-realm+orgs, managed auth) — premises held.
- Billing/trial gate — foundation exclusion (P5).
- DR/backup + DEPROVISION/RODO erasure — proposed at final gate, not auto-added.
- Migration fan-out orchestrator for N tenant DBs (routine-release path) — proposed at gate.

### Decision Audit Trail
| # | Phase | Decision | Class | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | CEO | Mode = SELECTIVE EXPANSION | Mechanical | autoplan | feature on greenfield foundation |
| 2 | CEO | Orchestrator → Postgres-state poller (drop RMQ+outbox+setTimeout) | TASTE | P5,P3 | crash-safe, less code; A kept if future event volume justifies RMQ → gate |
| 3 | CEO | Premises P1-P5 held | User | gate D2 | user chose Hold & bulletproof |
| 4 | CEO | F1-F8 fixes accepted into plan | Mechanical | P2,P1 | clear bugs in blast radius, <1d |
| 5 | CEO | F9 (DR/deprovision) → propose at gate | — | P5 | launch-gating but scope held |
| 6 | CEO | F10 (realm cliff/slug) → User Challenge | UserChallenge | both models | never auto-decided |

### CEO Completion Summary
Plan 2 is well-structured TDD-first and cleanly reuses Plan 1. It is **not yet bulletproof**:
3 critical (F1 retry durability, F2 idempotency, F3 Keycloak silent failure) and 1 high
security (F4 credential leak) gaps must be fixed before this ships. Architecture premises
held by user; premise challenge + DR/deprovision + realm-cliff carried to final gate.

## Phase 3 — Eng Review

Dual voices: Claude subagent (full, cross-checked Plan 1 schema) + Codex (full verdict —
reasoned from the complete plan after sandbox blocked its grep commands). **Both models
independently returned "NOT mergeable as written" and confirmed F1-F7.** Consensus: CONFIRMED
on all 6 eng dimensions.
Test plan artifact written to `~/.gstack/projects/HRobot/twilk-master-test-plan-20260531-plan02.md`.

### Codex-confirmed + Codex-only additions
- DONE advances after unchecked Keycloak fetches → tenant can be ACTIVE with no realm/admin.
  **Accept:** DONE must verify invariants (DB reachable, migrations applied, seed present,
  realm/client/admin user present) before setting ACTIVE. (strengthens C4)
- `KeycloakSetupStep` uses password grant (`username:'admin'`, `password: KEYCLOAK_ADMIN_CLIENT_SECRET`)
  but `KEYCLOAK_ADMIN_PASSWORD` is **not in the env schema** — config gap. **Accept** (with H5:
  switch to client_credentials + a confidential admin client, validate the exact secret in parseEnv).
- **M7 (new):** `POST /api/auth/signup` has no `@Throttle`, CAPTCHA, or email verification —
  unauthenticated caller can spam unlimited tenant + DB + realm creation. **Accept:** strict
  signup throttle + email verification before the expensive pipeline starts.

## Phase 3.5 — DX Review

Dual voices: Claude subagent (DX 3.5/10) + Codex (DX 4/10) — **both full verdicts, strong
agreement.** Consumers: Next.js frontend (Plans 4-5), the Plan 3 engineer, the operator.

```
DX DUAL VOICES — CONSENSUS TABLE
  Dimension                          Claude   Codex   Consensus
  ────────────────────────────────── ──────── ─────── ──────────
  1. Getting started < 5 min?        NO(1-2d) NO(1.5-3d) CONFIRMED
  2. API contract guessable?         PARTIAL  PARTIAL  CONFIRMED-partial
  3. Error messages actionable?      NO       NO       CONFIRMED
  4. Docs findable & complete?       NO       NO       CONFIRMED
  5. Operator recovery path?         NO       NO(crit) CONFIRMED
  6. Dev environment friction-free?  NO       NO       CONFIRMED
```

### DX Scorecard (8 dimensions)
| Dimension | Score | Note |
|---|---|---|
| Getting started / TTHW | 2/10 | 3 stacked silent first-run failures; TTHW ~1-2 days vs spec's ~30 min |
| API contract ergonomics | 5/10 | names guessable; async signup→poll state machine undocumented |
| Error messages | 2/10 | raw prisma stderr leak; opaque 500; Keycloak "false success" |
| Documentation | 2/10 | no quickstart README; contract only in backend enums |
| Operator DX | 2/10 | no failed-job list, no retry; "alert" = a log line |
| Defaults / escape hatches | 3/10 | retry/backoff/poll/rate-limits all hardcoded |
| Consistency / coherence | 4/10 | `error` vs `message`; job `step` vs tenant `status`; 409 shape ≠ wire shape |
| First-run / onboarding | 1/10 | no `.env.example`, no global-admin seed, API not in compose, 5433/5432 mismatch |
| **Overall** | **~3.5/10** | bones solid; consumer-facing skin missing |

### DX findings accepted (auto — completeness/explicit)
- **A** complete root `.env.example` (10 vars, values matching the compose stack) + a Task step to create it.
- **D** Keycloak admin auth: fix `KEYCLOAK_ADMIN_*` var to match compose bootstrap or switch to client_credentials; add the exact var to `env.ts`.
- **E** fix `POSTGRES_SUPERUSER_URL` example (5433/postgres → real 5432/hrobot superuser) or add the second PG + document.
- **F** global-admin seed script / documented bootstrap INSERT (login is 401 out of the box).
- **G** add `api` (+ `web`) to docker-compose, or document the `pnpm dev` step (spec promised `docker compose up`).
- **H/I** publish the async contract: return `{ tenantStatus, step, attemptCount, errorCode, errorMessage, done }`; document step values + poll cadence + ~12.5min worst-case; export a shared response type.
- **J/M** single RFC7807-style error envelope; assert the REAL Nest wire shape in the 409 test (plan's own test currently disagrees with its prose).
- **K** operator surface: `GlobalAdminGuard` `GET /api/admin/provision/jobs?status=FAILED` + `POST .../:id/retry` (~30 lines each, reuse idempotent steps).
- **L** lift retry count/backoff/poll/batch/rate-limits into validated config (dev-friendly overrides; 30s/2m/10m backoff is hostile to local dev).
- **N** decorate `LoginDto` (= Eng M4).
- health `/ready` should also check RabbitMQ + Keycloak admin reachability.

### ⚠ Structural meta-finding (applies to the whole review — surfaced at final gate)
Both the Eng and DX subagents independently flagged: **the accepted CEO/Eng/DX fixes are
recorded in this review report, NOT in the numbered Task 1-11 steps.** A developer running
the plan task-by-task (subagent-driven-development) ships the un-fixed code. The fixes must
be folded into the executable task steps, or the review is decorative. → Final-gate decision.

### DX Decision Audit Trail (appended)
| # | Phase | Decision | Class | Principle |
|---|---|---|---|---|
| 10 | DX | A,D,E,F,G,H,I,J,K,L,N + health → accepted | Mechanical | P1,P5 |
| 11 | DX | Fold-fixes-into-task-steps → final-gate decision | Meta | bias-to-action vs completeness |

### Merge-blocking fixes (auto-accepted — clear bugs, in blast radius)
| ID | Finding (symbol) | Severity | Fix |
|---|---|---|---|
| C1 | retry = in-process `setTimeout` + consumer acks before retry fires → lost on pod restart | Critical | durable `ProvisioningJob.nextAttemptAt` + poller cron; drop setTimeout (→ orchestrator Approach B) |
| C2 | `CreateDbStep` not idempotent: `CREATE USER` fails on retry; `randomBytes` password regenerated each attempt breaks stored db_url auth | Critical | guard via `pg_roles`/`pg_database`; generate+persist password (encrypted) before DDL; `ALTER ROLE` to reconverge |
| C3 | `OutboxRelayService` multi-pod double-publish (no claim) | Critical | `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` |
| C4 | `KeycloakSetupStep` checks `resp.ok` on 0/5 fetches; 409 on retry → `userId=''` → reset email 404 → tenant ACTIVE but admin locked out | Critical | check every response; GET-or-create per resource; never derive userId from Location alone |
| C5 | `spawnSync` blocks the single event loop (HTTP + AMQP heartbeat); prod image almost certainly lacks `prisma` CLI + tenant schema | Critical | async spawn or separate worker process; use Plan 1 `migrateTenant` wrapper; package prisma+schema, pin CWD; real-migrate integration test |
| H1 | unauth `GET /provision/status/:jobId` returns `lastError` = prisma stderr containing tenant `DATABASE_URL` + password | High | redact `postgresql://[^@]*@` + bearer tokens before persist; return coarse status from the endpoint |
| M4 | `LoginDto` has no class-validator decorators → `ValidationPipe({whitelist:true})` strips email/password to undefined → **global-admin login can never succeed** | High (functional) | add `@IsEmail()` / `@IsString() @MinLength(1)`; add a pipe-level spec |

### Also accepted (cleanups / hardening)
H2 DLQ + stop blind-ack + admin `POST /provision/:jobId/retry`; H3 `pg.Pool` + `'error'` handler;
H4 use `ProvisioningStep.DONE`, guard `PENDING→ACTIVE` + terminal short-circuit in dispatcher;
H5 dedicated Keycloak service-account client (client_credentials) not master ROPC, rename env var;
M1 full UUID for db/role names; M2 outbox attempt-cap + single-flight + publisher-confirms;
M3 inject validated `ENV` provider, remove `process.env['POSTGRES_SUPERUSER_URL'] ?? ''`;
M5 `app.set('trust proxy', …)` + delete dead `THROTTLER:MODULE_OPTIONS` snippet (lines 2552-2557);
M6 signup idempotency note; L1 fix `RETRY_DELAYS_MS` cap mismatch (10-min backoff never fires);
EncryptionService base64-vs-base64url contract test across the step boundary.

### Eng Architecture note (Section 1)
Split the blocking provisioning worker from the HTTP server (TASTE — couples to orchestrator
Approach B). SPOFs: single `SUPERUSER_PG_CLIENT` (→ Pool), single `TENANT_DB_ENCRYPTION_KEY`
(one key = all tenant DBs; tested rotation proposed at gate).

### Eng Decision Audit Trail (appended)
| # | Phase | Decision | Class | Principle |
|---|---|---|---|---|
| 7 | Eng | C1-C5,H1,M4 → required fixes before merge | Mechanical | P1,P2 |
| 8 | Eng | H2-H5,M1-M3,M5,M6,L1 + base64 contract → accepted cleanups | Mechanical | P5,P4 |
| 9 | Eng | worker/HTTP split | TASTE | P3 (couples to orchestrator B) |

