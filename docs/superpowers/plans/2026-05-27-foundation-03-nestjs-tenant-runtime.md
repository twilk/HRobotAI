<!-- /autoplan restore point: /c/Users/Wilk/.gstack/projects/HRobot/master-autoplan-restore-20260531-013416-plan03.md -->
# Foundation Plan 3 — NestJS Tenant Runtime

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the tenant-scoped request pipeline to `apps/api` — Keycloak JWT verification with dynamic realm discovery, Redis-cached tenant resolution with Postgres fallback, per-request tenant PrismaClient binding, RBAC guard, audit interceptor, a proof-of-stack `/api/employees` endpoint, and the onboarding-checklist PATCH endpoint.

**Architecture:** Every authenticated tenant request flows through three NestJS primitives in order: `KeycloakJwtGuard` (verifies the JWT signature using the tenant realm's Keycloak JWKS endpoint), `TenantContextInterceptor` (extracts the slug from `iss`, looks up `{ tenantId, status }` in Redis with a Postgres fallback, resolves the tenant PrismaClient via `TenantPrismaManager`, and stamps it onto the request object), then `RbacGuard` (reads `hrobot_roles` from the verified JWT and checks the `@Roles()` decorator). `AuditInterceptor` runs post-handler on mutating requests to write append-only `audit_log` rows using the request-bound tenant client.

**Tech Stack:** `jwks-rsa` (dynamic JWKS for Keycloak realm verification), `passport-jwt`, `@nestjs/passport`, `ioredis` (tenant-slug cache), `@hrobot/db` `TenantPrismaManager` (LRU-cached per-tenant Prisma connections), `rxjs/operators` (tap for AuditInterceptor), `prom-client` (tenant_redis_fallback_total counter), TypeScript 5 strict.

**Scope boundary:** Plan 3 of 5. Plan 2 delivered the control-plane HTTP layer and provisioning pipeline. This plan delivers the tenant-scoped runtime layer and two proof-of-stack endpoints. The Next.js frontend (signup page, provisioning status, tenant dashboard, employees page) is Plans 4–5.

**Working directory:** `C:\Users\Wilk\Documents\WORKSPACE\hrobot-control-plane-api`
**Branch:** create new branch `feat/tenant-runtime` from `feat/control-plane-api`

---

## ⚠ APPLIED REVIEW FIXES — MANDATORY, supersede the inline code below (folded 2026-05-31 by /autoplan)

Both reviewers returned "NOT mergeable." These fix the merge-blockers + add the composed
decorator + local-auth quickstart. They supersede the inline code in the referenced Tasks.

### FIX-P3-1 (CRITICAL) — validate JWT issuer before trusting JWKS (Task 2, `keycloak-jwt.strategy.ts`)
The strategy fetches the signing key from the token's OWN unverified `iss` → an attacker hosts
their own JWKS and forges a valid token for any tenant (full auth bypass on a PESEL-holding system).
In `secretOrKeyProvider`, after decoding, BEFORE building `jwksUri`. Validate the FULL issuer
(host + a bounded slug), not just a prefix — a bare `startsWith('…/realms/hrobot-')` admits
`hrobot-acme.evil` or a trailing path on the pinned host:
```typescript
const tail = payload?.iss?.startsWith(this.keycloakUrl)
  ? payload.iss.slice(this.keycloakUrl.length) : ''
// slug shape mirrors the signup slug regex (Plan 2 SignupDto)
if (!/^\/realms\/hrobot-[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(tail)) {
  done(new Error('Untrusted token issuer')); return   // makes the previously-dead keycloakUrl load-bearing
}
```
Add `audience: parseEnv().KEYCLOAK_CLIENT_ID` to the strategy options (MANDATORY — reject tokens
not minted for `hrobot-web`; do not treat as optional). The downstream TenantContextInterceptor
still resolves the slug against the tenant table as a second backstop. **Fix the Task-2 test** (lines ~199-209) to assert a foreign-issuer token is REJECTED
(it currently asserts acceptance — it encodes the vulnerability).

### FIX-P3-2 (CRITICAL, cross-plan) — roles/mapper in Plan 2
Plan 3 RBAC reads `hrobot_roles`, but Plan 2's KEYCLOAK_SETUP never creates roles/mapper. The fix
lives in Plan 2 (see Plan 2's FIX-C4b). Until that lands, `@Roles(...)` is unsatisfiable end-to-end.

### FIX-P3-3 (HIGH) — actually wire the AuditInterceptor (Task 6, `tenant-runtime.module.ts`)
It is bound to no route today. Register it globally so it can't be forgotten:
```typescript
import { APP_INTERCEPTOR } from '@nestjs/core'
// in providers:
{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
```
(APP_INTERCEPTOR wraps controller-level interceptors, so TenantContextInterceptor's pre-phase still
binds the client before Audit's post-phase reads it.) Add an e2e test asserting a mutation writes
exactly one `audit_log` row.

### FIX-P3-4 (HIGH, RODO) — never write raw bodies/PESEL to the immutable audit_log (Task 5)
Replace `payload: { body: request.body, params: request.params }` with a field allowlist (or denylist
that strips `pesel` + other PII). Prefer a `@Audit({action, entityType})` decorator read via Reflector,
with the handler supplying a sanitized `before/after`. Test: `pesel` never appears in `audit_log`.

### FIX-P3-5 (HIGH) — tenant cache invalidation (Task 3 + the control-plane status mutation)
On any tenant status transition: `redis.del('tenant:slug:'+slug)` AND `tenantManager.evict(tenantId)`
(Plan 1 exposes `evict`); broadcast via Redis pub/sub for multi-pod. Interim: drop the cache TTL to
30-60s. Otherwise a SUSPENDED tenant keeps full PII access 5-10+ min.

### FIX-P3-7 (HIGH) — composed `@TenantRoute()` decorator (new shared file)
Stop hand-stacking three decorators per controller (forget the interceptor → `@CurrentTenantClient`
undefined → crash; forget RbacGuard → `@Roles` silent no-op):
```typescript
import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common'
export const TenantRoute = (...roles: Role[]) => applyDecorators(
  UseGuards(KeycloakJwtGuard, RbacGuard),
  UseInterceptors(TenantContextInterceptor),
  ...(roles.length ? [Roles(...roles)] : []),
)
```
Use `@TenantRoute(Role.ADMIN_KLIENTA)` on EmployeesController/OnboardingController.

### FIX-P3-11 (DRY+security) — one hardened slug parser
`extractSlug` is duplicated in the strategy and the interceptor. Extract `realmSlugFromIssuer(iss,
keycloakBaseUrl)` to `@hrobot/shared` (enforcing the host allowlist from FIX-P3-1) and use in both,
so the security fix can't land in only one copy.

### Local-auth quickstart (DX) — so a frontend dev can actually get a token
Add **mailpit** (mail-catcher) to docker-compose, enable `directAccessGrantsEnabled` on the local
`hrobot-web` client, seed a test user, and document the local token path (ROPC `curl`) in
`apps/api/README.md`. TTHW → <30 min.

### Accepted cleanups (report checklist)
P3-8 typed response DTOs + stable `errorCode` (distinguish 401/403/suspended); P3-9 correct the
architecture prose (NestJS runs ALL guards before interceptors — "Guard→Interceptor→Guard" is
impossible); P3-10 strip `undefined` before the onboarding merge; P3-12 provide `EncryptionService`
once (CommonModule), not re-`new`'d per module; P3-13 fix `@Roles` typing.

---

## File Structure

**New files under `apps/api/src/`:**

```
apps/api/src/
├── tenant-runtime/
│   ├── tenant-runtime.module.ts             # @Global() — exports all tenant runtime primitives
│   ├── keycloak/
│   │   ├── keycloak-jwt.strategy.ts         # Passport strategy: JWKS from iss claim, dynamic realm
│   │   ├── keycloak-jwt.guard.ts            # AuthGuard('keycloak-jwt')
│   │   └── keycloak-jwt.strategy.spec.ts
│   ├── tenant-context/
│   │   ├── tenant-context.interceptor.ts    # Redis → Postgres fallback → TenantPrismaManager
│   │   ├── tenant-context.interceptor.spec.ts
│   │   └── current-tenant-client.decorator.ts  # @CurrentTenantClient() param decorator
│   ├── rbac/
│   │   ├── roles.decorator.ts               # @Roles(...Role[])
│   │   ├── rbac.guard.ts                    # reads hrobot_roles from JWT
│   │   └── rbac.guard.spec.ts
│   ├── audit/
│   │   ├── audit.service.ts                 # auditService.log({...}) → tenant audit_log
│   │   ├── audit.service.spec.ts
│   │   └── audit.interceptor.ts             # POST/PATCH/PUT/DELETE → AuditService.log
│   └── tenant-prisma/
│       ├── tenant-connection-resolver.service.ts  # TenantConnectionResolver impl (decrypt db_url)
│       └── tenant-prisma.module.ts          # provides TenantPrismaManager singleton
├── employees/
│   ├── employees.module.ts
│   ├── employees.controller.ts              # GET /employees (KeycloakJwtGuard + @Roles)
│   └── employees.controller.spec.ts
└── onboarding/
    ├── onboarding.module.ts
    ├── onboarding.controller.ts             # PATCH /tenants/me/onboarding-checklist
    └── onboarding.controller.spec.ts
```

**Modified files:**
- `apps/api/package.json` — add `jwks-rsa` dependency
- `apps/api/src/app.module.ts` — import `TenantRuntimeModule`, `EmployeesModule`, `OnboardingModule`

---

## Task 1: TenantPrismaModule — TenantConnectionResolver + TenantPrismaManager provider

**Files:**
- Create: `apps/api/src/tenant-runtime/tenant-prisma/tenant-connection-resolver.service.ts`
- Create: `apps/api/src/tenant-runtime/tenant-prisma/tenant-prisma.module.ts`
- Modify: `apps/api/package.json` — add `jwks-rsa`

The `TenantPrismaManager` from `@hrobot/db` needs a `TenantConnectionResolver` that decrypts the `tenants.db_url` from the control-plane DB. This module provides the manager as a NestJS singleton.

- [ ] **Step 1: Add `jwks-rsa` to `apps/api/package.json`**

Under `"dependencies"`, add:
```json
"jwks-rsa": "^3.1.0"
```
Under `"devDependencies"`, add:
```json
"@types/jwks-rsa": "^3.0.3"
```

Then install:
```
pnpm install
```

- [ ] **Step 2: Create `apps/api/src/tenant-runtime/tenant-prisma/tenant-connection-resolver.service.ts`**

```typescript
import { Injectable } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import type { TenantConnectionResolver } from '@hrobot/db'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'

@Injectable()
export class TenantConnectionResolverService implements TenantConnectionResolver {
  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async resolveDbUrl(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { dbUrl: true },
    })
    if (!tenant.dbUrl) throw new Error(`Tenant ${tenantId} has no db_url — not yet provisioned`)
    return this.encryption.decrypt(tenant.dbUrl)
  }
}
```

- [ ] **Step 3: Create `apps/api/src/tenant-runtime/tenant-prisma/tenant-prisma.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { TenantPrismaManager, TenantClient } from '@hrobot/db'
import { EncryptionService } from '@hrobot/shared'
import { parseEnv } from '@hrobot/config'
import { TenantConnectionResolverService } from './tenant-connection-resolver.service.js'

@Module({
  providers: [
    TenantConnectionResolverService,
    {
      provide: EncryptionService,
      useFactory: (): EncryptionService =>
        new EncryptionService(Buffer.from(parseEnv().TENANT_DB_ENCRYPTION_KEY, 'hex')),
    },
    {
      provide: TenantPrismaManager,
      useFactory: (resolver: TenantConnectionResolverService): TenantPrismaManager =>
        new TenantPrismaManager(
          resolver,
          (datasourceUrl: string) => new TenantClient({ datasourceUrl }),
        ),
      inject: [TenantConnectionResolverService],
    },
  ],
  exports: [TenantPrismaManager],
})
export class TenantPrismaModule {}
```

- [ ] **Step 4: Verify TypeScript compiles**

```
cd apps/api && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/src/tenant-runtime/tenant-prisma
git commit -m "feat(api): add TenantPrismaModule — TenantConnectionResolver + TenantPrismaManager singleton"
```

---

## Task 2: KeycloakJwtGuard — dynamic JWKS verification

**Files:**
- Create: `apps/api/src/tenant-runtime/keycloak/keycloak-jwt.strategy.ts`
- Create: `apps/api/src/tenant-runtime/keycloak/keycloak-jwt.strategy.spec.ts`
- Create: `apps/api/src/tenant-runtime/keycloak/keycloak-jwt.guard.ts`

The Keycloak JWT's `iss` claim encodes the realm: `http://localhost:8080/realms/hrobot-acme`. The strategy decodes the token (without verifying), reads `iss` to build the JWKS URI, fetches the signing key, and verifies the signature.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/tenant-runtime/keycloak/keycloak-jwt.strategy.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { KeycloakJwtStrategy, JwtPayload } from './keycloak-jwt.strategy.js'

describe('KeycloakJwtStrategy', () => {
  let strategy: KeycloakJwtStrategy

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KeycloakJwtStrategy],
    }).compile()
    strategy = module.get(KeycloakJwtStrategy)
  })

  it('returns the payload when iss contains a valid realm slug', () => {
    const payload: JwtPayload = {
      sub: 'user-uuid-1',
      iss: 'http://localhost:8080/realms/hrobot-acme',
      hrobot_roles: ['ADMIN_KLIENTA'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    expect(strategy.validate(payload)).toEqual(payload)
  })

  it('throws UnauthorizedException when iss does not contain a known realm', () => {
    const payload: JwtPayload = {
      sub: 'user-1',
      iss: 'http://evil.example.com/realms/other',
      hrobot_roles: [],
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    // validate() only enforces iss format — JWKS verification is handled by secretOrKeyProvider
    // If iss is not from KEYCLOAK_URL, it will fail at signing-key resolution (tested via integration)
    expect(strategy.validate(payload)).toEqual(payload)
  })

  it('extracts slug from iss claim', () => {
    const iss = 'http://localhost:8080/realms/hrobot-my-company'
    // Access the private helper through the class method directly
    const slug = (strategy as unknown as { extractSlug(iss: string): string }).extractSlug(iss)
    expect(slug).toBe('my-company')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=keycloak-jwt.strategy
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/tenant-runtime/keycloak/keycloak-jwt.strategy.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy, StrategyOptionsWithRequest } from 'passport-jwt'
import { Request } from 'express'
import * as jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { parseEnv } from '@hrobot/config'

export interface JwtPayload {
  sub: string
  iss: string
  hrobot_roles: string[]
  exp: number
  [key: string]: unknown
}

type JwtDoneCallback = (err: Error | null, key?: string) => void

@Injectable()
export class KeycloakJwtStrategy extends PassportStrategy(Strategy, 'keycloak-jwt') {
  private readonly logger = new Logger(KeycloakJwtStrategy.name)
  private readonly keycloakUrl = parseEnv().KEYCLOAK_URL

  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: false,
      secretOrKeyProvider: async (
        _req: Request,
        rawToken: string,
        done: JwtDoneCallback,
      ): Promise<void> => {
        try {
          const decoded = jwt.decode(rawToken, { complete: true })
          const payload = decoded?.payload as JwtPayload | undefined
          const header = decoded?.header

          if (!payload?.iss || !header?.kid) {
            done(new Error('Missing iss or kid in JWT'))
            return
          }

          // FIX-P3-1 (CRITICAL): iss is attacker-controlled (this is an UNVERIFIED decode).
          // Validate the FULL issuer (host + a BOUNDED slug) before fetching its JWKS — a bare
          // startsWith('.../realms/hrobot-') admits hrobot-acme.evil or a trailing path on the host.
          const issTail = payload.iss.startsWith(this.keycloakUrl)
            ? payload.iss.slice(this.keycloakUrl.length)
            : ''
          if (!/^\/realms\/hrobot-[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(issTail)) {
            done(new Error('Untrusted token issuer'))
            return
          }

          const jwksUri = `${payload.iss}/protocol/openid-connect/certs`
          const client = jwksClient({
            jwksUri,
            cache: true,
            cacheMaxAge: 600_000, // 10 min
            rateLimit: true,
            jwksRequestsPerMinute: 10,
          })

          const signingKey = await client.getSigningKey(header.kid)
          done(null, signingKey.getPublicKey())
        } catch (err) {
          this.logger.warn({ err }, 'JWT key resolution failed')
          done(err instanceof Error ? err : new Error(String(err)))
        }
      },
    } as StrategyOptionsWithRequest)
  }

  /** Extracts the tenant slug from an iss like "http://localhost:8080/realms/hrobot-acme" */
  extractSlug(iss: string): string {
    const match = /\/realms\/hrobot-(.+)$/.exec(iss)
    return match?.[1] ?? ''
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload
  }
}
```

- [ ] **Step 4: Create `apps/api/src/tenant-runtime/keycloak/keycloak-jwt.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class KeycloakJwtGuard extends AuthGuard('keycloak-jwt') {}
```

- [ ] **Step 5: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=keycloak-jwt.strategy
```
Expected: 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tenant-runtime/keycloak
git commit -m "feat(api): add KeycloakJwtStrategy with dynamic JWKS resolution from iss claim"
```

---

## Task 3: TenantContextInterceptor + @CurrentTenantClient decorator

**Files:**
- Create: `apps/api/src/tenant-runtime/tenant-context/tenant-context.interceptor.ts`
- Create: `apps/api/src/tenant-runtime/tenant-context/tenant-context.interceptor.spec.ts`
- Create: `apps/api/src/tenant-runtime/tenant-context/current-tenant-client.decorator.ts`

This interceptor runs after `KeycloakJwtGuard`. It reads `request.user.iss`, extracts the tenant slug, looks up `{ id, status }` from Redis (TTL 5 min), falls back to Postgres on Redis error, resolves the tenant PrismaClient, and stamps `tenantId` + `tenantClient` onto the Express request object.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/tenant-runtime/tenant-context/tenant-context.interceptor.spec.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { of } from 'rxjs'
import { TenantContextInterceptor } from './tenant-context.interceptor.js'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { RedisService } from '../../common/redis/redis.service.js'
import { TenantPrismaManager } from '@hrobot/db'
import { Counter } from 'prom-client'

const mockPrisma = {
  tenant: { findFirst: jest.fn() },
}

const mockRedis = {
  client: {
    get: jest.fn(),
    setex: jest.fn(),
  },
}

const mockTenantClient = { employee: { findMany: jest.fn() } }
const mockTenantManager = { getClient: jest.fn() }

const mockCounter = { inc: jest.fn() }

function makeContext(iss: string): ExecutionContext {
  const request = {
    user: { iss, sub: 'user-1', hrobot_roles: ['ADMIN_KLIENTA'] },
    tenantId: undefined as string | undefined,
    tenantClient: undefined as unknown,
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getRequest: () => request,
  } as unknown as ExecutionContext
}

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantContextInterceptor,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: TenantPrismaManager, useValue: mockTenantManager },
        { provide: 'REDIS_FALLBACK_COUNTER', useValue: mockCounter },
      ],
    }).compile()
    interceptor = module.get(TenantContextInterceptor)
    jest.clearAllMocks()
    mockTenantManager.getClient.mockResolvedValue(mockTenantClient)
  })

  it('resolves tenant from Redis cache and binds tenantClient to request', async () => {
    const ctx = makeContext('http://localhost:8080/realms/hrobot-acme')
    const req = ctx.switchToHttp().getRequest() as Record<string, unknown>
    mockRedis.client.get.mockResolvedValue(JSON.stringify({ id: 'tenant-1', status: 'ACTIVE' }))

    let completed = false
    interceptor.intercept(ctx, { handle: () => { completed = true; return of(null) } } as never).subscribe()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(req['tenantId']).toBe('tenant-1')
    expect(req['tenantClient']).toBe(mockTenantClient)
    expect(mockPrisma.tenant.findFirst).not.toHaveBeenCalled()
    expect(mockCounter.inc).not.toHaveBeenCalled()
  })

  it('falls back to Postgres when Redis throws and increments fallback counter', async () => {
    const ctx = makeContext('http://localhost:8080/realms/hrobot-acme')
    const req = ctx.switchToHttp().getRequest() as Record<string, unknown>
    mockRedis.client.get.mockRejectedValue(new Error('Redis ECONNREFUSED'))
    mockRedis.client.setex.mockRejectedValue(new Error('Redis ECONNREFUSED'))
    mockPrisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' })

    interceptor.intercept(ctx, { handle: () => of(null) } as never).subscribe()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(req['tenantId']).toBe('tenant-1')
    expect(req['tenantClient']).toBe(mockTenantClient)
    expect(mockCounter.inc).toHaveBeenCalledTimes(1)
  })

  it('throws ForbiddenException when tenant status is not ACTIVE', async () => {
    const ctx = makeContext('http://localhost:8080/realms/hrobot-acme')
    mockRedis.client.get.mockResolvedValue(JSON.stringify({ id: 'tenant-1', status: 'SUSPENDED' }))

    let error: Error | undefined
    interceptor.intercept(ctx, { handle: () => of(null) } as never).subscribe({
      error: (e: Error) => { error = e },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(error?.constructor.name).toBe('ForbiddenException')
  })

  it('throws UnauthorizedException when tenant slug cannot be resolved', async () => {
    const ctx = makeContext('http://localhost:8080/realms/hrobot-acme')
    mockRedis.client.get.mockResolvedValue(null)
    mockPrisma.tenant.findFirst.mockResolvedValue(null)

    let error: Error | undefined
    interceptor.intercept(ctx, { handle: () => of(null) } as never).subscribe({
      error: (e: Error) => { error = e },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(error?.constructor.name).toBe('UnauthorizedException')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=tenant-context.interceptor
```

- [ ] **Step 3: Create `apps/api/src/tenant-runtime/tenant-context/tenant-context.interceptor.ts`**

```typescript
import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common'
import { Observable, from, switchMap } from 'rxjs'
import type { Counter } from 'prom-client'
import { TenantPrismaManager } from '@hrobot/db'
import { TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import { RedisService } from '../../common/redis/redis.service.js'
import type { JwtPayload } from '../keycloak/keycloak-jwt.strategy.js'

interface TenantCacheEntry {
  id: string
  status: string
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name)
  private readonly CACHE_TTL_SEC = 300 // 5 min

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly redis: RedisService,
    private readonly tenantManager: TenantPrismaManager,
    @Inject('REDIS_FALLBACK_COUNTER') private readonly fallbackCounter: Counter,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.resolve(ctx)).pipe(switchMap(() => next.handle()))
  }

  private async resolve(ctx: ExecutionContext): Promise<void> {
    const request = ctx.switchToHttp().getRequest<{
      user: JwtPayload
      tenantId: string
      tenantClient: unknown
    }>()

    const slug = this.extractSlug(request.user?.iss ?? '')
    if (!slug) throw new UnauthorizedException('Cannot resolve tenant from token')

    const cacheKey = `tenant:slug:${slug}`
    const entry = await this.lookupTenant(cacheKey, slug)

    if (entry.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException('Tenant account is not active')
    }

    const client = await this.tenantManager.getClient(entry.id)
    request.tenantId = entry.id
    request.tenantClient = client
  }

  private async lookupTenant(cacheKey: string, slug: string): Promise<TenantCacheEntry> {
    // 1. Try Redis
    try {
      const cached = await this.redis.client.get(cacheKey)
      if (cached) return JSON.parse(cached) as TenantCacheEntry
    } catch (err) {
      this.logger.warn({ err }, 'Redis unavailable, falling back to DB for tenant resolution')
      this.fallbackCounter.inc()
    }

    // 2. Postgres fallback
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true, status: true },
    })
    if (!tenant) throw new UnauthorizedException(`Unknown tenant slug: ${slug}`)

    const entry: TenantCacheEntry = { id: tenant.id, status: tenant.status }

    // Attempt to populate Redis for next request (best-effort)
    try {
      await this.redis.client.setex(cacheKey, this.CACHE_TTL_SEC, JSON.stringify(entry))
    } catch {
      // Redis still down — acceptable, will fall back again next request
    }

    return entry
  }

  private extractSlug(iss: string): string {
    const match = /\/realms\/hrobot-(.+)$/.exec(iss)
    return match?.[1] ?? ''
  }
}
```

- [ ] **Step 4: Create `apps/api/src/tenant-runtime/tenant-context/current-tenant-client.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'

/**
 * Extracts the per-request tenant PrismaClient stamped onto the Express request
 * by TenantContextInterceptor. Only works on routes protected by KeycloakJwtGuard
 * and TenantContextInterceptor.
 *
 * @example
 * async findAll(@CurrentTenantClient() client: TenantClient) { ... }
 */
export const CurrentTenantClient = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantClient => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>()
    return request['tenantClient'] as TenantClient
  },
)

export const CurrentTenantId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>()
    return request['tenantId'] as string
  },
)
```

- [ ] **Step 5: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=tenant-context.interceptor
```
Expected: 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tenant-runtime/tenant-context
git commit -m "feat(api): add TenantContextInterceptor — Redis cache, Postgres fallback, tenant client binding"
```

---

## Task 4: RbacGuard + @Roles decorator

**Files:**
- Create: `apps/api/src/tenant-runtime/rbac/roles.decorator.ts`
- Create: `apps/api/src/tenant-runtime/rbac/rbac.guard.ts`
- Create: `apps/api/src/tenant-runtime/rbac/rbac.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/tenant-runtime/rbac/rbac.guard.spec.ts`:

```typescript
import { Reflector } from '@nestjs/core'
import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { RbacGuard } from './rbac.guard.js'
import { ROLES_KEY } from './roles.decorator.js'

function makeContext(roles: string[], requiredRoles: string[]): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { hrobot_roles: roles } }),
    }),
    getClass: () => ({}),
    getHandler: () => ({}),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
    getType: () => 'http',
  } as unknown as ExecutionContext
}

describe('RbacGuard', () => {
  let guard: RbacGuard
  let reflector: Reflector

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RbacGuard, Reflector],
    }).compile()
    guard = module.get(RbacGuard)
    reflector = module.get(Reflector)
  })

  it('allows access when no @Roles decorator is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined)
    expect(guard.canActivate(makeContext(['PRACOWNIK'], []))).toBe(true)
  })

  it('allows access when user has a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['HR', 'ADMIN_KLIENTA'])
    expect(guard.canActivate(makeContext(['ADMIN_KLIENTA'], ['HR', 'ADMIN_KLIENTA']))).toBe(true)
  })

  it('throws ForbiddenException when user lacks all required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN_KLIENTA'])
    expect(() => guard.canActivate(makeContext(['PRACOWNIK'], ['ADMIN_KLIENTA']))).toThrow(
      ForbiddenException,
    )
  })

  it('throws ForbiddenException when user has no roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['HR'])
    expect(() => guard.canActivate(makeContext([], ['HR']))).toThrow(ForbiddenException)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=rbac.guard
```

- [ ] **Step 3: Create `apps/api/src/tenant-runtime/rbac/roles.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common'
import { Role } from '@hrobot/shared'

export const ROLES_KEY = 'hrobot_required_roles'

/**
 * Restrict a route to users with at least one of the specified roles.
 * Roles are read from the Keycloak JWT `hrobot_roles` claim.
 *
 * @example
 * @Roles(Role.HR, Role.ADMIN_KLIENTA)
 */
export const Roles = (...roles: (typeof Role)[keyof typeof Role][]): MethodDecorator =>
  SetMetadata(ROLES_KEY, roles)
```

- [ ] **Step 4: Create `apps/api/src/tenant-runtime/rbac/rbac.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from './roles.decorator.js'
import type { JwtPayload } from '../keycloak/keycloak-jwt.strategy.js'

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])

    // No @Roles decorator → route is public to any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) return true

    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>()
    const userRoles: string[] = request.user?.hrobot_roles ?? []

    const hasRole = requiredRoles.some((r) => userRoles.includes(r))
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied: required roles [${requiredRoles.join(', ')}]`,
      )
    }
    return true
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=rbac.guard
```
Expected: 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tenant-runtime/rbac
git commit -m "feat(api): add RbacGuard with @Roles decorator — reads hrobot_roles from Keycloak JWT"
```

---

## Task 5: AuditService + AuditInterceptor

**Files:**
- Create: `apps/api/src/tenant-runtime/audit/audit.service.ts`
- Create: `apps/api/src/tenant-runtime/audit/audit.service.spec.ts`
- Create: `apps/api/src/tenant-runtime/audit/audit.interceptor.ts`

`AuditService.log()` writes an append-only row to the tenant's `audit_log` table (the Postgres trigger in the tenant schema enforces immutability). `AuditInterceptor` fires `AuditService.log()` post-response on mutating requests (POST/PATCH/PUT/DELETE) using the request-bound tenant client.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/tenant-runtime/audit/audit.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { AuditService, AuditLogInput } from './audit.service.js'

describe('AuditService', () => {
  let service: AuditService

  const mockCreate = jest.fn()

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService],
    }).compile()
    service = module.get(AuditService)
    jest.clearAllMocks()
  })

  it('calls auditLog.create on the tenant client with the correct payload', async () => {
    const tenantClient = { auditLog: { create: mockCreate } }
    mockCreate.mockResolvedValue({ id: 'log-1' })

    const input: AuditLogInput = {
      tenantClient: tenantClient as never,
      actorUserId: 'user-uuid-1',
      action: 'employee.update',
      entityType: 'Employee',
      entityId: 'emp-uuid-1',
      payload: { before: { position: 'Junior' }, after: { position: 'Senior' } },
      ipAddress: '127.0.0.1',
    }

    await service.log(input)

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-uuid-1',
        action: 'employee.update',
        entityType: 'Employee',
        entityId: 'emp-uuid-1',
        payload: { before: { position: 'Junior' }, after: { position: 'Senior' } },
        ipAddress: '127.0.0.1',
      },
    })
  })

  it('logs a warning and does not throw when the tenant client is unavailable', async () => {
    // tenantClient may be absent if called outside a tenant context (should not happen, but be safe)
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await service.log({
      tenantClient: null as never,
      actorUserId: 'u',
      action: 'x',
      entityType: 'T',
      entityId: 'id',
      payload: {},
      ipAddress: '0.0.0.0',
    })
    consoleSpy.mockRestore()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=audit.service
```

- [ ] **Step 3: Create `apps/api/src/tenant-runtime/audit/audit.service.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'

export interface AuditLogInput {
  tenantClient: TenantClient
  actorUserId: string
  action: string        // e.g. "employee.update"
  entityType: string    // e.g. "Employee"
  entityId: string
  payload: Record<string, unknown>
  ipAddress: string
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  async log(input: AuditLogInput): Promise<void> {
    if (!input.tenantClient) {
      this.logger.warn('AuditService.log called without a tenant client — skipping')
      return
    }

    await input.tenantClient.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: input.payload,
        ipAddress: input.ipAddress,
      },
    })
  }
}
```

- [ ] **Step 4: Create `apps/api/src/tenant-runtime/audit/audit.interceptor.ts`**

```typescript
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Observable, tap } from 'rxjs'
import type { TenantClient } from '@hrobot/db'
import { AuditService } from './audit.service.js'
import type { JwtPayload } from '../keycloak/keycloak-jwt.strategy.js'

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name)

  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = ctx.switchToHttp().getRequest<{
      method: string
      path: string
      ip: string
      body: unknown
      params: Record<string, string>
      user: JwtPayload
      tenantClient: TenantClient
    }>()

    if (!MUTATING_METHODS.has(request.method.toUpperCase())) {
      return next.handle()
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit
            .log({
              tenantClient: request.tenantClient,
              actorUserId: request.user?.sub ?? 'anonymous',
              action: `${request.method.toLowerCase()}.${request.path}`,
              entityType: 'Request',
              entityId: request.path,
              payload: {
                body: request.body,
                params: request.params,
              },
              ipAddress: request.ip ?? '0.0.0.0',
            })
            .catch((err: Error) =>
              this.logger.error({ err }, 'Failed to write audit log'),
            )
        },
      }),
    )
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=audit.service
```
Expected: 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tenant-runtime/audit
git commit -m "feat(api): add AuditService and AuditInterceptor — append-only audit_log writes on mutations"
```

---

## Task 6: TenantRuntimeModule — wire all tenant runtime primitives

**Files:**
- Create: `apps/api/src/tenant-runtime/tenant-runtime.module.ts`
- Modify: `apps/api/src/app.module.ts`

This module registers the Keycloak strategy, the Prometheus counter, the TenantPrismaModule, and exports the guards, interceptors, and decorators that feature modules need.

- [ ] **Step 1: Create `apps/api/src/tenant-runtime/tenant-runtime.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { makeCounterProvider } from '@willsoto/nestjs-prometheus'
import { TenantPrismaModule } from './tenant-prisma/tenant-prisma.module.js'
import { KeycloakJwtStrategy } from './keycloak/keycloak-jwt.strategy.js'
import { KeycloakJwtGuard } from './keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from './tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from './rbac/rbac.guard.js'
import { AuditService } from './audit/audit.service.js'
import { AuditInterceptor } from './audit/audit.interceptor.js'

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'keycloak-jwt' }),
    TenantPrismaModule,
  ],
  providers: [
    KeycloakJwtStrategy,
    KeycloakJwtGuard,
    TenantContextInterceptor,
    RbacGuard,
    AuditService,
    AuditInterceptor,
    makeCounterProvider({
      name: 'tenant_redis_fallback_total',
      help: 'Number of times Redis was unavailable and the Postgres fallback was used for tenant resolution',
    }),
    {
      provide: 'REDIS_FALLBACK_COUNTER',
      useFactory: (counter: { inc(): void }) => counter,
      inject: ['PROM_METRIC_TENANT_REDIS_FALLBACK_TOTAL'],
    },
  ],
  exports: [
    KeycloakJwtGuard,
    TenantContextInterceptor,
    RbacGuard,
    AuditService,
    AuditInterceptor,
    TenantPrismaModule,
  ],
})
export class TenantRuntimeModule {}
```

- [ ] **Step 2: Register `TenantRuntimeModule` in `apps/api/src/app.module.ts`**

Add `TenantRuntimeModule` to the `imports` array (import it at the top). The module must come after `CommonModule` (which provides `ControlPlanePrismaService` and `RedisService`) since `TenantRuntimeModule` depends on them via `@Global()`.

Read `apps/api/src/app.module.ts`, then add the import:
```typescript
import { TenantRuntimeModule } from './tenant-runtime/tenant-runtime.module.js'
// Add TenantRuntimeModule to the imports array, after CommonModule
```

- [ ] **Step 3: Verify build**

```
cd apps/api && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Run all tests**

```
cd apps/api && pnpm test
```
Expected: all existing tests still green (≥20).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tenant-runtime/tenant-runtime.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): wire TenantRuntimeModule — Keycloak JWT, tenant context, RBAC, audit, Redis fallback counter"
```

---

## Task 7: EmployeesModule — proof-of-stack endpoint

**Files:**
- Create: `apps/api/src/employees/employees.controller.ts`
- Create: `apps/api/src/employees/employees.controller.spec.ts`
- Create: `apps/api/src/employees/employees.module.ts`
- Modify: `apps/api/src/app.module.ts`

`GET /api/employees` is the proof-of-stack endpoint. It validates the full tenant request chain: subdomain → Keycloak JWT → tenant context → tenant PrismaClient → real DB query.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/employees/employees.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { EmployeesController } from './employees.controller.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'

const mockEmployees = [
  {
    id: 'emp-1',
    firstName: 'Jan',
    lastName: 'Kowalski',
    position: 'Developer',
    employmentType: 'UMOWA_O_PRACE',
    hiredAt: new Date('2024-01-15'),
  },
]

const mockTenantClient = {
  employee: {
    findMany: jest.fn(),
  },
}

// Bypass all guards/interceptors in unit test
const mockGuard = { canActivate: (ctx: ExecutionContext) => { void ctx; return true } }
const mockInterceptor = {
  intercept: (ctx: ExecutionContext, next: { handle(): unknown }) => { void ctx; return next.handle() },
}

describe('EmployeesController', () => {
  let controller: EmployeesController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeesController],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(mockGuard)
      .overrideGuard(RbacGuard).useValue(mockGuard)
      .overrideInterceptor(TenantContextInterceptor).useValue(mockInterceptor)
      .compile()
    controller = module.get(EmployeesController)
    jest.clearAllMocks()
  })

  it('returns an array of employees from the tenant DB', async () => {
    mockTenantClient.employee.findMany.mockResolvedValue(mockEmployees)
    const result = await controller.findAll(mockTenantClient as never)
    expect(result).toEqual(mockEmployees)
    expect(mockTenantClient.employee.findMany).toHaveBeenCalledWith({
      orderBy: { hiredAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        employmentType: true,
        hiredAt: true,
        unitId: true,
      },
    })
  })

  it('returns an empty array when no employees exist', async () => {
    mockTenantClient.employee.findMany.mockResolvedValue([])
    const result = await controller.findAll(mockTenantClient as never)
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=employees.controller
```

- [ ] **Step 3: Create `apps/api/src/employees/employees.controller.ts`**

```typescript
import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import { CurrentTenantClient } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'

@Controller('employees')
@UseGuards(KeycloakJwtGuard, RbacGuard)
@UseInterceptors(TenantContextInterceptor)
export class EmployeesController {
  /**
   * Proof-of-stack endpoint. Returns all employees for the authenticated tenant.
   * Frontend shows the onboarding empty state when the list is empty.
   * pesel is intentionally excluded (RODO PII — never returned in API responses).
   */
  @Get()
  async findAll(@CurrentTenantClient() client: TenantClient): Promise<unknown[]> {
    return client.employee.findMany({
      orderBy: { hiredAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        employmentType: true,
        hiredAt: true,
        unitId: true,
        // pesel: NEVER included — RODO PII
      },
    })
  }
}
```

- [ ] **Step 4: Create `apps/api/src/employees/employees.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { EmployeesController } from './employees.controller.js'

@Module({ controllers: [EmployeesController] })
export class EmployeesModule {}
```

- [ ] **Step 5: Register `EmployeesModule` in `apps/api/src/app.module.ts`**

Add to the `imports` array:
```typescript
import { EmployeesModule } from './employees/employees.module.js'
// add EmployeesModule to imports
```

- [ ] **Step 6: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=employees.controller
```
Expected: 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/employees apps/api/src/app.module.ts
git commit -m "feat(api): add EmployeesModule — GET /employees proof-of-stack endpoint (PESEL excluded per RODO)"
```

---

## Task 8: Onboarding checklist endpoint

**Files:**
- Create: `apps/api/src/onboarding/onboarding.controller.ts`
- Create: `apps/api/src/onboarding/onboarding.controller.spec.ts`
- Create: `apps/api/src/onboarding/onboarding.module.ts`
- Modify: `apps/api/src/app.module.ts`

`PATCH /api/tenants/me/onboarding-checklist` reads the `tenantId` from the request context, partially merges the body into `tenants.onboarding_checklist` on the **control-plane** DB, and returns the updated checklist. Requires `ADMIN_KLIENTA` role.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/onboarding/onboarding.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext } from '@nestjs/common'
import { OnboardingController, OnboardingDto } from './onboarding.controller.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'

const mockPrisma = {
  tenant: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
}

const mockGuard = { canActivate: (ctx: ExecutionContext) => { void ctx; return true } }
const mockInterceptor = {
  intercept: (ctx: ExecutionContext, next: { handle(): unknown }) => { void ctx; return next.handle() },
}

describe('OnboardingController', () => {
  let controller: OnboardingController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(KeycloakJwtGuard).useValue(mockGuard)
      .overrideGuard(RbacGuard).useValue(mockGuard)
      .overrideInterceptor(TenantContextInterceptor).useValue(mockInterceptor)
      .compile()
    controller = module.get(OnboardingController)
    jest.clearAllMocks()
  })

  it('merges the partial update into the existing checklist and returns the result', async () => {
    const existingChecklist = { addEmployees: false, configureSchedule: false, inviteUsers: false }
    const updatedChecklist = { addEmployees: true, configureSchedule: false, inviteUsers: false }

    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({
      onboardingChecklist: existingChecklist,
    })
    mockPrisma.tenant.update.mockResolvedValue({ onboardingChecklist: updatedChecklist })

    const dto: OnboardingDto = { addEmployees: true }
    const result = await controller.update('tenant-1', dto)
    expect(result).toEqual(updatedChecklist)

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { onboardingChecklist: updatedChecklist },
      select: { onboardingChecklist: true },
    })
  })

  it('does not overwrite keys absent from the partial update', async () => {
    const existingChecklist = { addEmployees: true, configureSchedule: false, inviteUsers: false }
    mockPrisma.tenant.findUniqueOrThrow.mockResolvedValue({ onboardingChecklist: existingChecklist })
    mockPrisma.tenant.update.mockResolvedValue({
      onboardingChecklist: { ...existingChecklist, inviteUsers: true },
    })

    const dto: OnboardingDto = { inviteUsers: true }
    await controller.update('tenant-1', dto)

    const callArgs = mockPrisma.tenant.update.mock.calls[0]?.[0] as {
      data: { onboardingChecklist: Record<string, boolean> }
    }
    expect(callArgs.data.onboardingChecklist['addEmployees']).toBe(true) // preserved
    expect(callArgs.data.onboardingChecklist['inviteUsers']).toBe(true)  // updated
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```
cd apps/api && pnpm test -- --testPathPattern=onboarding.controller
```

- [ ] **Step 3: Create `apps/api/src/onboarding/onboarding.controller.ts`**

```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { IsBoolean, IsOptional } from 'class-validator'
import { Role } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { KeycloakJwtGuard } from '../tenant-runtime/keycloak/keycloak-jwt.guard.js'
import { TenantContextInterceptor } from '../tenant-runtime/tenant-context/tenant-context.interceptor.js'
import { RbacGuard } from '../tenant-runtime/rbac/rbac.guard.js'
import { Roles } from '../tenant-runtime/rbac/roles.decorator.js'
import { CurrentTenantId } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'

export class OnboardingDto {
  @IsOptional()
  @IsBoolean()
  addEmployees?: boolean

  @IsOptional()
  @IsBoolean()
  configureSchedule?: boolean

  @IsOptional()
  @IsBoolean()
  inviteUsers?: boolean
}

@Controller('tenants/me')
@UseGuards(KeycloakJwtGuard, RbacGuard)
@UseInterceptors(TenantContextInterceptor)
export class OnboardingController {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  /**
   * Partial update of the org-level onboarding checklist.
   * Merges provided keys into the existing JSON — absent keys are preserved.
   * Persisted on the control-plane tenants row; survives device switching.
   */
  @Patch('onboarding-checklist')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN_KLIENTA)
  async update(
    @CurrentTenantId() tenantId: string,
    @Body() dto: OnboardingDto,
  ): Promise<Record<string, boolean>> {
    const existing = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { onboardingChecklist: true },
    })

    const merged = {
      ...(existing.onboardingChecklist as Record<string, boolean>),
      ...(dto as Record<string, boolean | undefined>),
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { onboardingChecklist: merged },
      select: { onboardingChecklist: true },
    })

    return updated.onboardingChecklist as Record<string, boolean>
  }
}
```

- [ ] **Step 4: Create `apps/api/src/onboarding/onboarding.module.ts`**

```typescript
import { Module } from '@nestjs/common'
import { OnboardingController } from './onboarding.controller.js'

@Module({ controllers: [OnboardingController] })
export class OnboardingModule {}
```

- [ ] **Step 5: Register `OnboardingModule` in `apps/api/src/app.module.ts`**

```typescript
import { OnboardingModule } from './onboarding/onboarding.module.js'
// add OnboardingModule to imports
```

- [ ] **Step 6: Run tests — expect PASS**

```
cd apps/api && pnpm test -- --testPathPattern=onboarding.controller
```
Expected: 2 tests green.

- [ ] **Step 7: Run full test suite**

```
cd apps/api && pnpm test
```
Expected: all tests green (≥28 — 20 from Plan 2 + 4 RbacGuard + 4 TenantContextInterceptor + 3 KeycloakJwtStrategy + 2 AuditService + 2 EmployeesController + 2 OnboardingController = **37 tests**).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/onboarding apps/api/src/app.module.ts
git commit -m "feat(api): add OnboardingModule — PATCH /tenants/me/onboarding-checklist (ADMIN_KLIENTA, partial merge)"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| AuthGuard verifies Keycloak JWT signature | Task 2 (KeycloakJwtStrategy JWKS) |
| TenantContextInterceptor extracts slug from iss | Task 3 |
| Redis-cached tenant lookup (5-min TTL) | Task 3 |
| Redis error → Postgres fallback + warn log | Task 3 |
| Fallback increments `tenant_redis_fallback_total` | Task 3 + Task 6 (Prometheus counter) |
| Binds TenantPrismaManager.getClient() to request | Task 3 |
| Suspended tenant → 403 | Task 3 |
| RbacGuard reads hrobot_roles from JWT | Task 4 |
| @Roles() decorator | Task 4 |
| AuditService.log() → tenant audit_log INSERT | Task 5 |
| AuditInterceptor on mutations (POST/PATCH/PUT/DELETE) | Task 5 |
| TenantPrismaManager singleton with LRU cache | Task 1 |
| TenantConnectionResolver decrypts db_url | Task 1 |
| GET /api/employees (full chain proof-of-stack) | Task 7 |
| pesel excluded from all API responses | Task 7 (select omits pesel) |
| PATCH /api/tenants/me/onboarding-checklist | Task 8 |
| ADMIN_KLIENTA required for checklist update | Task 8 (@Roles) |
| Partial merge — absent keys preserved | Task 8 (merge with spread) |

**Placeholder scan:** No TBD, no "implement later", no "add error handling" without code. Every step has either code or an exact shell command.

**Type consistency:**
- `JwtPayload.hrobot_roles: string[]` defined in Task 2, used in Tasks 3, 4, 8 ✅
- `CurrentTenantClient` returns `TenantClient` from `@hrobot/db` used in Tasks 7, 8 ✅
- `CurrentTenantId` returns `string` used in Task 8 ✅
- `AuditLogInput.tenantClient: TenantClient` matches Task 5 ✅
- `TenantStatus.ACTIVE` from `@hrobot/shared` used in Task 3 ✅

---

Plan complete and saved to `docs/superpowers/plans/2026-05-27-foundation-03-nestjs-tenant-runtime.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review after each, parallel where independent (Tasks 2, 3, 4 can run simultaneously; Tasks 7, 8 can run simultaneously)

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

---

<!-- ════════════════════════════════════════════════════════════════════ -->
<!-- /autoplan REVIEW — generated 2026-05-31. Premises inherited from Plan 2 -->
<!-- (DB-per-tenant, realm-per-tenant, self-hosted Keycloak) — HELD by user.  -->
<!-- ════════════════════════════════════════════════════════════════════ -->

# /autoplan Review Report — Plan 3 (Tenant Runtime)

## Phase 1 — CEO (compressed)
Plan 3 introduces no new strategic premises; it is the runtime layer on Plan 2's architecture,
whose premises the user HELD at the Plan 2 premise gate. No redundant premise gate. Strategic
note: Plan 3's security model (JWT trust) and audit/compliance layer are load-bearing for the
entire multi-tenant isolation + RODO story — so the Eng-phase security findings below are
effectively CEO-level risks.

## Phase 3 — Eng Review
Voices: Claude subagent (full, traced against Plan 1+2) + Codex (partial — exhausted turn reading
two large plan files; no clean verdict). Claude verdict: **NOT mergeable as written.** My own
line-by-line trace + the live worktree confirm the criticals.

### Merge-blockers
| ID | Finding (symbol) | Severity | Fix |
|---|---|---|---|
| P3-1 | `keycloak-jwt.strategy.ts` builds JWKS URI from the token's **own unverified `iss`** (`jwt.decode`→`payload.iss`); `keycloakUrl` field is declared but **never read**. No `aud`/`azp`/issuer check. Attacker hosts own JWKS + signs token w/ `iss=…/realms/hrobot-acme` → verification PASSES → full auth bypass + cross-tenant PII (PESEL) breach. Plan's own test (lines 199-209) encodes the hole as intended. | **CRITICAL** | reject unless `iss.startsWith(KEYCLOAK_URL+'/realms/hrobot-')`; reconstruct jwksUri from validated host; add `audience: KEYCLOAK_CLIENT_ID`; fix the test to assert rejection |
| P3-2 | **Cross-plan, VERIFIED in live worktree:** Plan 2 `keycloak-setup.step.ts` creates realm/client/user but **no roles, no role-assignment, no protocol mapper** → JWT never carries `hrobot_roles` → Plan 3 `RbacGuard`/`@Roles(ADMIN_KLIENTA)` is unsatisfiable → the tenant's own admin gets 403 on the onboarding PATCH. | **CRITICAL** | fix Plan 2 KEYCLOAK_SETUP: create realm roles + `hrobot_roles` protocol mapper + assign ADMIN_KLIENTA to the initial user (chip spawned) |
| P3-3 | `AuditInterceptor` is provided in TenantRuntimeModule but bound to **no route** (controllers only `@UseInterceptors(TenantContextInterceptor)`; not APP_INTERCEPTOR) → audit trail silently never runs; all unit tests still pass. | **HIGH** | register `{provide: APP_INTERCEPTOR, useClass: AuditInterceptor}` after tenant-context; add an e2e test asserting an audit row is written |
| P3-4 | `AuditInterceptor` writes raw `request.body` (Employee mutations carry `pesel`) into the **immutable** `audit_log` → unrecoverable PII; RODO Art. 5(1)(c)/16/17 violation. Records are also generic (`action:'post./api/…'`, `entityType:'Request'`) vs the rich `AuditLogInput` contract. | **HIGH** | field allowlist/denylist (never log `pesel`); `@Audit({action,entityType})` decorator + sanitized before/after; test that `pesel` never reaches audit_log |
| P3-5 | TenantContextInterceptor caches `{id,status}` in Redis 5 min with **no invalidation**; TenantPrismaManager client cache adds 10 min idle TTL with `updateAgeOnGet` → SUSPENDED tenant retains full PII access 5-10+ min. | **HIGH** | on status change: `DEL tenant:slug:<slug>` + `tenantManager.evict(id)` (Plan 1 exposes evict); pub/sub for multi-pod; short TTL interim |
| P3-6 | Local login is a dead end: temp-credential + `execute-actions-email`, but no SMTP/mail-catcher in compose, ephemeral Keycloak H2, public client lacks `directAccessGrantsEnabled` → no way to get a token locally → TTHW ≈ ∞. | **HIGH** | add mailpit to compose + `directAccessGrants` for local + a documented token path / seed user |
| P3-7 | No composed `@TenantRoute()` decorator: every controller hand-stacks `@UseGuards(KeycloakJwtGuard,RbacGuard)` + `@UseInterceptors(TenantContextInterceptor)`. Forget the interceptor → `@CurrentTenantClient` returns undefined → runtime crash. Forget RbacGuard → `@Roles` is a **silent no-op** (security hole). | **HIGH** | `applyDecorators(...)` composed `@TenantRoute()`; both DX voices flagged |

### Also accepted (cleanups)
P3-8 typed + documented API contracts (`unknown[]` → typed DTO/shared type; `Record<string,boolean>`
documented; distinguishable 401/403/suspended via stable `errorCode`); P3-9 correct the
architecture prose (NestJS runs all guards before interceptors — the "Guard→Interceptor→Guard"
order is impossible; harmless today since RbacGuard needs only JWT roles); P3-10 onboarding merge:
strip undefined before spread (else omitted optional keys clobber existing values); P3-11
`extractSlug` is duplicated in strategy + interceptor — extract one hardened `@hrobot/shared`
util (so the P3-1 fix can't land in only one copy); P3-12 `EncryptionService` is re-`new`'d per
module (key-mismatch risk) → provide once in CommonModule; P3-13 fix `@Roles` typing; flaky
`setTimeout(0|10)` tests → use `lastValueFrom`.

### Eng consensus + DX
```
ENG: Claude=NOT mergeable (P3-1..P3-7) · Codex=partial · my trace=CONFIRMS criticals
DX:  Claude 3.5/10 (found cross-plan roles blocker) · Codex 5.5/10 (Plan 3 only) ·
     CONFIRMED on: undocumented local-auth (TTHW 2-4h+), untyped/indistinguishable contracts,
     missing composed @TenantRoute decorator.
```
Test plan: `~/.gstack/projects/HRobot/twilk-master-test-plan-20260531-plan03.md`.

## NOT in scope (premises held / deferred)
Architecture pivots (inherited from Plan 2, held). Connection-pool ceiling under DB-per-tenant
(100 clients × pools × pods) → architecture gate, see TODOS. Audit of control-plane mutations
(onboarding writes control-plane DB, not tenant DB — audit model needs a deliberate decision).

## Decision Audit Trail (Plan 3)
| # | Phase | Decision | Class | Principle |
|---|---|---|---|---|
| 1 | CEO | premises inherited from Plan 2, held; no new premise gate | Mechanical | bias-to-action |
| 2 | Eng | P3-1..P3-7 → merge-blockers, fixes required | Mechanical | P1,P2 |
| 3 | Eng | P3-2 roles gap → cross-plan (Plan 2 fix); chip spawned | UserChallenge/meta | both DX voices + verified |
| 4 | Eng | P3-8..P3-13 → accepted cleanups | Mechanical | P5,P4 |
| 5 | — | connection-pool ceiling → architecture gate (TODOS) | — | P5 |

