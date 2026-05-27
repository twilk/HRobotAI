# HRobot.AI — Foundation Sub-project Design

**Date:** 2026-05-27  
**Sub-project:** Foundation (1 of N)  
**Status:** Approved — ready for implementation planning

---

## 1. Scope

The Foundation sub-project delivers the structural bedrock that every subsequent HR module is built on. It produces no end-user HR functionality beyond a single proof-of-stack "employees list" page, but it makes the entire SaaS production-worthy from day one.

### Included

- Turborepo monorepo scaffolding (`apps/web`, `apps/api`, `packages/db`, `packages/shared`, `packages/config`, `infra/`)
- Two-plane NestJS architecture: control plane + tenant runtime
- DB-per-tenant: control-plane Postgres + per-tenant Postgres with LRU-cached connection manager
- Prisma schemas: control-plane schema + tenant schema (with migration fan-out tooling)
- Keycloak realm-per-tenant: provisioning via Admin REST API
- Self-serve signup + fully automated async provisioning pipeline (CREATE_DB → RUN_MIGRATIONS → SEED → KEYCLOAK_SETUP → DONE) with rollback
- Subdomain-based tenant routing in Next.js middleware
- Auth.js v5 OIDC integration with dynamic Keycloak realm selection
- Design system migration from demo (glassmorphism, Navy/Cyan tokens, all UI components)
- DESIGN.md: design system documentation (color tokens, glassmorphism spec, typography, component inventory, Keycloak theme spec)
- Keycloak login theme: Navy/Cyan glassmorphism applied via FreeMarker templates, deployed in KEYCLOAK_SETUP provisioning step
- Signup page: full-width centered glassmorphism form with live slug preview + debounced availability check
- Provisioning status page: step tracker + per-step Polish benefit copy + failure state (email saved + ops notified)
- Sidebar: grouped nav (MODUŁY HR / ADMINISTRACJA), mobile drawer, RBAC-visibility-aware
- Dashboard: welcome screen with greeting, 3 quick-action cards, setup checklist (not a blank stub)
- Employees list empty state: onboarding treatment with explanation + primary CTA + secondary CTA (CSV import, "coming soon")
- `GET /api/slugs/check/{slug}`: slug availability check endpoint (no auth, called by signup form)
- RBAC: 5 roles (Pracownik, Manager, HR, Admin klienta, Admin globalny)
- Audit log: append-only, per-tenant DB, DB-enforced immutability
- Structured logging (Pino), Prometheus metrics, OpenTelemetry tracing
- Health check endpoints
- Docker Compose (local dev) + Terraform skeleton (EU region)
- Test suite: unit + integration (tenant isolation) + E2E (Playwright)

### Excluded (next sub-projects)

- All HR module business logic (employees CRUD, scheduling, leave requests, access management)
- AI agents (Grafik Manager, Analityk HR, Voice Agent)
- Mobile app (React Native + Expo)
- External integrations (ZUS/Płatnik, ERP, RCP/RFID)
- Billing / subscription management

### Definition of Done

- `docker compose up` starts the full local stack (Postgres, Redis, RabbitMQ, Keycloak, API, web)
- Signup flow completes: form (slug live preview works) → provisioning progress (5 steps + benefit copy) → ACTIVE tenant
- Keycloak first-login screen uses HRobot Navy/Cyan theme, not default Keycloak UI
- ADMIN_KLIENTA lands on welcome dashboard (greeting + quick actions + setup checklist), not a blank page
- Employees list shows onboarding empty state (explanation + two CTAs), not "No items found."
- Mobile sidebar drawer opens on hamburger tap at 375px
- ADMIN_KLIENTA gets a 403 when accessing another tenant's subdomain
- All tests pass in CI: unit → integration → E2E
- `infra/terraform/` plan applies without error against an empty EU-region environment
- DESIGN.md committed to repo root

---

## 2. Monorepo Structure

```
hrobot/
├── apps/
│   ├── web/                  # Next.js 16 App Router — signup site + tenant HR panel
│   └── api/                  # NestJS modular monolith — control plane + tenant runtime
├── packages/
│   ├── shared/               # TypeScript types, DTOs, Zod schemas, role/permission enums
│   ├── db/                   # Prisma schemas (control-plane + tenant) + migration tooling
│   └── config/               # Shared eslint / tsconfig / prettier configs
├── infra/
│   ├── docker/               # Dockerfiles + docker-compose.yml (local dev)
│   └── terraform/            # IaC skeleton, EU region, per-env modules
└── turbo.json
    package.json              # pnpm workspaces
```

**Toolchain:** pnpm workspaces, Turborepo for build/lint/test orchestration, TypeScript strict mode everywhere, ESLint + Prettier via shared `packages/config`.

`apps/mobile/` (React Native + Expo) slots in as a later sub-project — directory reserved, not scaffolded.

---

## 3. Two-plane NestJS Architecture

### Control plane

Handles: tenant registry, provisioning orchestration, global admin operations. Connects exclusively to the control-plane Postgres DB. Never touches a tenant DB directly.

NestJS modules: `TenantsModule`, `ProvisioningModule`, `AuthModule` (global admin JWT), `HealthModule`.

### Tenant runtime

Handles: all HR domain logic. Every request is scoped to one tenant — the tenant DB connection is resolved at request time and never crosses tenants.

Request processing chain:
```
Incoming request
  → AuthGuard          — verifies Keycloak JWT signature
  → TenantContextInterceptor — extracts tenant slug from JWT iss claim
                               → Redis-cached control-plane lookup → tenant_id
                               → TenantPrismaManager.getClient(tenant_id)
                               → binds PrismaClient to request context
  → RbacGuard          — reads hrobot_roles from JWT, checks against route decorator
  → Service method     — uses injected tenant PrismaClient, never global client
  → AuditInterceptor   — writes append-only audit_log row on mutations
  → Response
```

**Defense-in-depth:** Isolation is physical (separate DB connections, separate Postgres databases), not logical (no shared DB + WHERE clauses). A bug that drops a filter condition cannot leak cross-tenant data.

---

## 4. Data Model

### Control-plane schema (`packages/db/prisma/control-plane.prisma`)

**`tenants`**
```
id              String    @id @default(uuid())
slug            String    @unique
name            String
status          TenantStatus  // PENDING | ACTIVE | SUSPENDED | DEPROVISIONED
db_url          String    // AES-256 encrypted connection string
plan            PlanType  // TRIAL | STANDARD | ENTERPRISE
metadata        Json      // { realmName, keycloakClientId }
created_at      DateTime  @default(now())
provisioned_at  DateTime?
```

**`provisioning_jobs`**
```
id              String    @id @default(uuid())
tenant_id       String    @relation(fields: [tenant_id], references: [id])
step            ProvisioningStep  // CREATE_DB | RUN_MIGRATIONS | SEED | KEYCLOAK_SETUP | DONE | FAILED
attempt_count   Int       @default(0)
last_error      String?
created_at      DateTime  @default(now())
updated_at      DateTime  @updatedAt
```

**`global_admins`**
```
id              String    @id @default(uuid())
email           String    @unique
password_hash   String
created_at      DateTime  @default(now())
```

Global admins (HRobot SaaS operators) authenticate via the control-plane directly, independent of Keycloak, so platform access survives Keycloak outages.

### Tenant schema (`packages/db/prisma/tenant.prisma`)

**`users`** — mirrors Keycloak subject for local role assignment
```
id              String    @id  // matches Keycloak sub (UUID)
email           String    @unique
keycloak_sub    String    @unique
active          Boolean   @default(true)
created_at      DateTime  @default(now())
```

**`user_roles`**
```
user_id         String
role            Role      // PRACOWNIK | MANAGER | HR | ADMIN_KLIENTA
unit_id         String?   // FK → organizational_units (scope Manager to a team)
@@id([user_id, role, unit_id])
```

Admin globalny (HRobot SaaS operator) never lives in a tenant DB — authenticated via control-plane.

**`organizational_units`**
```
id              String    @id @default(uuid())
name            String
parent_id       String?   @relation("UnitTree", fields: [parent_id], references: [id])
manager_user_id String?   @relation(fields: [manager_user_id], references: [id])
```

**`employees`** (proof-of-stack entity — validates the full request chain end-to-end)
```
id              String    @id @default(uuid())
user_id         String?   @relation(fields: [user_id], references: [id])
first_name      String
last_name       String
pesel           String    // AES-256 encrypted at application layer before write
position        String
employment_type EmploymentType
hired_at        DateTime
unit_id         String    @relation(fields: [unit_id], references: [id])
created_at      DateTime  @default(now())
updated_at      DateTime  @updatedAt
```

PESEL is encrypted in the application layer before every write and decrypted after every read. Plaintext PESEL never touches the DB or any log line.

**`audit_log`** — append-only
```
id              String    @id @default(uuid())
actor_user_id   String
action          String    // e.g. "employee.update"
entity_type     String
entity_id       String
payload         Json      // { before: {...}, after: {...} }
ip_address      String
created_at      DateTime  @default(now())
```

A Postgres `BEFORE UPDATE OR DELETE` trigger on `audit_log` raises an exception — immutability enforced at the DB layer as a second line of defense after the application-layer INSERT-only policy.

### Prisma connection manager

`packages/db/src/TenantPrismaManager.ts` — NestJS singleton:

- LRU cache: max 100 entries, 10-minute idle TTL
- Cache miss: decrypt `tenants.db_url` → instantiate `new PrismaClient({ datasourceUrl })` → `$connect()` → cache
- LRU eviction: `client.$disconnect()` called before entry removal
- `evict(tenantId)`: called explicitly on tenant suspension/deprovisioning
- At 100 active connections per API replica, horizontal scaling requires PgBouncer or Prisma Accelerate in production

### Migration fan-out

`packages/db/scripts/migrate-all-tenants.ts` — runs at deploy time after control-plane migration:

1. `SELECT id, db_url FROM tenants WHERE status = 'ACTIVE'`
2. For each tenant (concurrency limit: 10): `prisma migrate deploy --schema=tenant.prisma` with `DATABASE_URL` set to decrypted tenant URL
3. Collect failures; exit non-zero if any tenant failed → blocks deployment, triggers API rollback

New tenant DBs also run `migrate deploy` inline during the `RUN_MIGRATIONS` provisioning step.

---

## 5. Auth — Keycloak Isolation Model

**Decision: realm-per-tenant.**

Each provisioned tenant gets its own Keycloak realm (`hrobot-{tenant-slug}`). This is physically consistent with DB-per-tenant — complete isolation at every layer. A realm is self-contained: its own users, sessions, client configs, password policies, and login page branding. Deleting a tenant means deleting one realm with no residual user records in a shared space.

### JWT structure

```json
{
  "sub": "{keycloak-user-uuid}",
  "iss": "https://auth.hrobot.ai/realms/hrobot-acme",
  "hrobot_roles": ["MANAGER"],
  "exp": ...
}
```

`TenantContextInterceptor` extracts the tenant slug from the `iss` claim — no custom header needed. `RbacGuard` reads `hrobot_roles` from the verified JWT — no DB roundtrip for role checks on read operations.

### Auth.js v5 configuration (`apps/web/auth.ts`)

```typescript
export const { handlers, auth, signIn, signOut } = NextAuth((req) => {
  const realm = req?.headers.get('x-keycloak-realm') ?? 'hrobot-default'
  return {
    providers: [
      Keycloak({
        clientId: env.KEYCLOAK_CLIENT_ID,
        issuer: `${env.KEYCLOAK_URL}/realms/${realm}`,
      }),
    ],
    callbacks: {
      jwt({ token, profile }) {
        if (profile?.hrobot_roles) token.roles = profile.hrobot_roles
        return token
      },
      session({ session, token }) {
        session.user.roles = token.roles
        return session
      },
    },
  }
})
```

The `x-keycloak-realm` header is set by Next.js middleware based on the subdomain → Redis-cached tenant lookup.

---

## 6. Self-serve Provisioning Pipeline

### Phase 1 — Signup request (synchronous, <100ms)

`POST /api/auth/signup`:
1. Validate: slug availability, email format, password strength
2. Create `tenants` row: `status = PENDING`
3. Create `provisioning_jobs` row: `step = CREATE_DB`, `attempt_count = 0`
4. Publish `{ jobId, tenantId }` to RabbitMQ exchange `tenant.provision`
5. Return `202 Accepted { jobId }`

Frontend navigates to `/signup/status?job={jobId}`, polls `GET /api/provision/status/{jobId}` every 3 seconds.

### Phase 2 — Async pipeline worker

NestJS `@MessagePattern('tenant.provision')` consumer. Each step is **idempotent** — the worker reads `provisioning_jobs.step` on pickup and resumes from the current step. Steps never repeat completed work.

```
CREATE_DB → RUN_MIGRATIONS → SEED → KEYCLOAK_SETUP → DONE
```

**CREATE_DB**
- Generate: `db_name = hrobot_t_{tenant_id_8chars}`, `db_user = hu_{tenant_id_8chars}`, 32-char random password
- Execute against Postgres superuser: `CREATE USER ... WITH PASSWORD ...; CREATE DATABASE ... OWNER ...`
- AES-256 encrypt connection URL, store in `tenants.db_url`
- Advance step → `RUN_MIGRATIONS`

**RUN_MIGRATIONS**
- Decrypt `tenants.db_url`; shell out: `prisma migrate deploy --schema=packages/db/prisma/tenant.prisma`
- `DATABASE_URL` env var set to tenant connection string for the duration
- Advance step → `SEED`

**SEED**
- Open tenant PrismaClient
- Insert: root `organizational_units` row ("Cała firma"), system config defaults
- Advance step → `KEYCLOAK_SETUP`

**KEYCLOAK_SETUP**
- Call Keycloak Admin REST API:
  1. `POST /admin/realms` → create realm `hrobot-{slug}` with RODO-compliant session TTL policy (short access token TTL, refresh token rotation)
  2. `POST /admin/realms/hrobot-{slug}/clients` → create client `hrobot-web`, redirect URIs to `https://{slug}.hrobot.ai/*`
  3. `POST /admin/realms/hrobot-{slug}/users` → create initial ADMIN_KLIENTA user, `temporaryPassword = true`
  4. Trigger credential-reset email (Keycloak built-in)
- Store `{ realmName, keycloakClientId }` in `tenants.metadata`
- Advance step → `DONE`

**DONE**
- `UPDATE tenants SET status = 'ACTIVE', provisioned_at = NOW()`
- Frontend poll receives `step = DONE` → redirects to `https://{slug}.hrobot.ai` (Keycloak prompts first-login password set)

### Failure handling and rollback

On any step exception:
1. `provisioning_jobs.last_error = error.message`, `attempt_count++`
2. If `attempt_count < 3`: re-enqueue with exponential backoff (30s → 2min → 10min) via RabbitMQ dead-letter + TTL
3. If `attempt_count >= 3`: `step = FAILED`, alert ops (email/Slack webhook)

Compensating actions (run in reverse order of what succeeded):
- KEYCLOAK_SETUP partially created realm → `DELETE /admin/realms/hrobot-{slug}`
- CREATE_DB succeeded but later step failed → `DROP DATABASE {db_name}; DROP USER {db_user}`
- `tenants.status` remains `PENDING`; never set to ACTIVE

### Status API

`GET /api/provision/status/{jobId}` (no auth — job ID is a secret UUID):
```json
{ "step": "KEYCLOAK_SETUP", "attemptCount": 1, "error": null }
```
Frontend renders a 5-step progress bar. On `step = FAILED`, shows error message + support contact.

---

## 7. App Shell

### Design system migration

Source: `C:\WORKSPACE\startup\demo\` (existing Next.js mockup).

Migrated verbatim into `apps/web/`:
- `components/ui/` — Button, Card, Badge, Input, Modal, SkipLink
- `components/layout/` — Sidebar, TopBar (wired to real auth: user name, role, logout)
- `app/globals.css` — glassmorphism styles, CSS variables (Navy `#0B1F3B`, Cyan `#00C1D4`)
- `tailwind.config.ts` — custom color tokens, `backdrop-filter` / `backdrop-blur` utilities
- Inter font via `next/font/google` in root `layout.tsx`

Demo mock data (`lib/mockData.ts`) and Zustand stores are discarded.

**DESIGN.md** is a Foundation deliverable. Created at repo root, it documents: color tokens, glassmorphism spec (blur radius, bg-opacity, border-opacity values), typography scale (Inter weights/sizes), spacing scale, component inventory with props, and Keycloak theme spec. Every subsequent sub-project references DESIGN.md rather than reverse-engineering the demo.

### Signup page design

Full-width centered layout on Navy `#0B1F3B` background. Single glassmorphism card (16px horizontal padding on mobile, max-w-md on desktop). Card edge-to-edge at 375px.

**Field order:**
1. Logo + "HRobot.AI" wordmark (centered top)
2. Heading: "Utwórz konto" / subheading: "Bezpłatne 14 dni. Bez karty kredytowej."
3. Company name (`<input>`)
4. Subdomain slug (`<input>`) with live preview: auto-lowercases, replaces spaces with hyphens, shows `Twój adres: {slug}.hrobot.ai` below field. Debounced availability check (300ms) → green checkmark when available, red X + "Ta nazwa jest już zajęta" when taken. Calls `GET /api/slugs/check/{slug}`.
5. Admin email (`<input type="email">`)
6. Password (`<input type="password">`) with strength indicator: `zxcvbn` library, 3-segment bar (red score 0-1 / orange score 2 / green score 3-4)
7. CTA: Cyan `#00C1D4` button "Utwórz konto"
8. Footer: "Masz już konto? [Zaloguj się]" link

**Validation errors:** inline, below each field, red text `#EF4444`. On submit error (server-side): error banner at top of card.

**Loading state:** Button shows spinner + "Tworzenie konta..." while POST /api/auth/signup is in flight.

### Provisioning status page design

Two-column layout (desktop): left = step progress, right = active benefit copy. Stacked (left over right) at 375px.

**Left column — step tracker:**
- 5 step indicators (circle + step name): CREATE_DB, RUN_MIGRATIONS, SEED, KEYCLOAK_SETUP, DONE
- Active step: Cyan circle, pulsing animation, step name bold
- Completed step: checkmark circle, dimmed
- Pending step: empty circle, dimmed
- Step progress bar: thin horizontal line connecting circles

**Right column — benefit copy per step:**
| Step | Copy (Polish) |
|------|---------------|
| CREATE_DB | "Tworzymy izolowaną bazę danych — Twoje dane nigdy nie dotykają systemów innych firm." |
| RUN_MIGRATIONS | "Konfigurujemy strukturę Twojej przestrzeni roboczej." |
| SEED | "Dodajemy domyślne ustawienia i pierwszą jednostkę organizacyjną." |
| KEYCLOAK_SETUP | "Konfigurujemy bezpieczne logowanie zgodne z RODO." |
| DONE | "Gotowe! Twoja przestrzeń robocza HRobot jest gotowa." |

**Failure state (step = FAILED after 3 attempts):**
- Heading: "Coś poszło nie tak"
- Body: "Twój adres email został zapisany — odezwiemy się w ciągu 1 godziny."
- Support link: "lub napisz na pomoc@hrobot.ai"
- Ops team receives Slack/email alert (already specified in Section 6)

### Sidebar navigation design

**Grouped nav — two labeled sections:**

```
[HRobot logo + wordmark]

MODUŁY HR
  📊 Dashboard
  👥 Pracownicy
  📅 Grafik
  📋 Wnioski
  🔑 Dostępy

ADMINISTRACJA
  ⚙️ Ustawienia
  👤 Użytkownicy (ADMIN_KLIENTA only)
```

Group labels: uppercase, 11px, muted color (`#6B7280`). Active item: Cyan left border + light Cyan background. Role-based visibility: Pracownik sees only modules relevant to their role, ADMIN group hidden for Pracownik.

**Mobile (≤768px):** Sidebar hides. Hamburger icon in TopBar opens a drawer overlay (full-height, slides from left, Navy background, same nav structure). Drawer closes on nav item click or outside tap.

### Dashboard page design

Welcome screen — not a blank stub. Content:

- Heading: "Witaj w HRobot, {tenantName}!" (personalized from JWT)
- Subheading: "Zacznij od kilku kroków, aby skonfigurować swój zespół."
- 3 quick-action Cards (glassmorphism):
  - "Dodaj pracownika" → links to `/pracownicy` (or future add-employee route)
  - "Skonfiguruj grafik" → links to `/grafik` (stub, visible future intent)
  - "Zaproś użytkowników" → links to `/ustawienia/uzytkownicy`
- Setup checklist (persisted per-tenant in localStorage until dismissed):
  - ☐ Dodaj pierwszego pracownika
  - ☐ Utwórz jednostkę organizacyjną
  - ☐ Ustaw strefy czasowe i godziny pracy

### Employees list empty state

```
[icon: Users or document-person, 48px, Cyan tint]
Heading: "Brak pracowników"
Body: "Dodaj pracowników, aby zacząć planować grafiki i obsługiwać wnioski urlopowe."
Primary CTA: [Cyan button] "Dodaj pracownika"
Secondary CTA: [ghost button, disabled] "Importuj z CSV" → `title="Dostępne wkrótce"` tooltip on hover; `aria-disabled="true"`, cursor-not-allowed. Data module team activates this button when import is implemented.
```

### Keycloak login theme

A custom Keycloak theme (`apps/web/keycloak-theme/`) is applied during the `KEYCLOAK_SETUP` provisioning step. The theme uses FreeMarker templates (Keycloak.v2) to apply:
- Navy `#0B1F3B` background
- Glassmorphism card for login/password-change form
- Inter font (loaded from CDN)
- Cyan CTA button

The `KEYCLOAK_SETUP` pipeline step uploads the theme to the Keycloak realm via the Admin REST API (theme file upload or pre-deployed to Keycloak's `themes/` directory). Password-change on first login appears in HRobot's design language, not Keycloak's default.

### Subdomain routing (`apps/web/middleware.ts`)

Runs on every request before any page renders:

1. Read `host` header → extract subdomain (`acme.hrobot.ai` → `acme`)
2. If no subdomain (or `www`/`hrobot.ai`) → marketing site, no tenant context
3. If subdomain present:
   - Check Redis cache for `{ tenantId, status, realmName }` keyed by slug (5-min TTL)
   - Cache miss → fetch from control-plane API → populate cache
   - If `status ≠ ACTIVE` → return 503 "Account suspended" page
   - Set request headers: `x-tenant-id`, `x-keycloak-realm`

All Server Components and Route Handlers read `headers().get('x-tenant-id')` — no prop drilling.

### Responsive behavior

| Breakpoint | Sidebar | Signup card | Status page | Employees list |
|------------|---------|-------------|-------------|----------------|
| 375px | Drawer (hamburger) | Full-width, 16px padding | Stacked (steps over copy) | Single column |
| 768px | Sidebar visible | max-w-md centered | Two-column | Single column |
| 1280px | Sidebar visible | max-w-md centered | Two-column | Table view |

### Accessibility

- Form inputs: `<label for>` on all fields, no placeholder-as-label
- Progress bar: `role="progressbar"`, `aria-valuenow={step}`, `aria-valuemax={5}`, `aria-valuetext={stepName}`
- Touch targets: ≥ 44px for all interactive elements
- Color contrast: WCAG 2.1 AA (Cyan `#00C1D4` on Navy `#0B1F3B` passes at 4.7:1)
- SkipLink component (already in demo): present on all authenticated pages

### Route structure

```
apps/web/app/
├── (marketing)/
│   ├── page.tsx                    # Landing page
│   ├── signup/
│   │   ├── page.tsx                # Signup form (centered card, slug preview, live validation)
│   │   └── status/page.tsx         # Provisioning progress (steps + benefit copy + failure state)
│   └── layout.tsx                  # Minimal layout, no sidebar
│
├── (tenant)/
│   ├── layout.tsx                  # Auth gate + Sidebar (grouped nav) + TopBar
│   ├── dashboard/page.tsx          # Welcome dashboard: greeting + 3 quick actions + setup checklist
│   ├── pracownicy/
│   │   ├── page.tsx                # Proof-of-stack: real API call + onboarding empty state
│   │   └── [id]/page.tsx           # Stub
│   ├── grafik/page.tsx             # Stub
│   ├── wnioski/page.tsx            # Stub
│   └── dostepy/page.tsx            # Stub
│
└── api/
    ├── auth/[...nextauth]/route.ts
    ├── slugs/check/[slug]/route.ts  # Debounced slug availability check (no auth)
    └── provision/status/[jobId]/route.ts   # No-auth status polling
```

`(tenant)/layout.tsx` auth gate:
```typescript
const session = await auth()
if (!session) redirect('/api/auth/signin')
```

### Proof-of-stack page

`pracownicy/page.tsx` makes a real authenticated `GET /api/employees` call and renders the response using existing Card + Badge components. This validates the full chain: subdomain → middleware → Auth.js session → Bearer token → NestJS TenantContextInterceptor → tenant PrismaClient → response → UI.

---

## 8. Cross-cutting Concerns

### Config and secrets

All env vars validated at startup via Zod schemas in `packages/config/env.ts`. App crashes on boot if any required variable is missing — no silent fallbacks.

Key secrets:
- `CONTROL_PLANE_DATABASE_URL` — control-plane Postgres
- `TENANT_DB_ENCRYPTION_KEY` — AES-256 key for `tenants.db_url` at-rest encryption
- `KEYCLOAK_ADMIN_CLIENT_SECRET` — provisioning pipeline Admin API
- `REDIS_URL`, `RABBITMQ_URL`
- `NEXTAUTH_SECRET` — Auth.js JWT signing

Key rotation for `TENANT_DB_ENCRYPTION_KEY` requires a migration script that re-encrypts all `tenants.db_url` rows; documented in `infra/docs/key-rotation.md`.

### Audit log

`AuditService` (NestJS injectable) is called by `AuditInterceptor` at the end of every mutating request, using the tenant's PrismaClient:

```typescript
await auditService.log({
  actorUserId: session.sub,
  action: 'employee.update',
  entityType: 'Employee',
  entityId: employee.id,
  payload: { before: oldData, after: newData },
  ipAddress: req.ip,
})
```

Application-layer policy: INSERT-only against `audit_log`. Postgres trigger enforces this at DB level: `BEFORE UPDATE OR DELETE ON audit_log → RAISE EXCEPTION`.

### Observability

**Structured logging:** Pino (JSON). Every log line includes: `tenantId`, `requestId` (UUID injected by middleware, propagated via AsyncLocalStorage), `userId`, `durationMs`. No `console.log` in application code.

**Metrics:** Prometheus-compatible, exposed at `/metrics` (internal port only). Tracked: request count, p50/p95/p99 latency per route, active tenant connection count, provisioning job duration per step, RabbitMQ queue depth.

**Tracing:** OpenTelemetry SDK wired into NestJS and Prisma query events. Spans cover: HTTP request → DB query → outbound Keycloak calls. OTLP export to Jaeger (local dev) / cloud tracing (production). `requestId` correlates logs and traces.

**Health checks:**
- `GET /health/live` — process alive
- `GET /health/ready` — control-plane DB + Redis + RabbitMQ reachable
Used by Docker/k8s liveness and readiness probes.

---

## 9. Testing Strategy

### Philosophy

Foundation tests prove two things type-checking cannot: **tenant isolation holds** (physically separate DB connections make cross-tenant leakage structurally impossible), and **the provisioning pipeline produces a usable tenant** from signup to first login.

### Test layers

**Unit tests (Jest, no DB)**
- `TenantPrismaManager`: LRU eviction calls `$disconnect`, correct connection string per tenant
- `TenantContextInterceptor`: tenant resolution, 401 on invalid JWT, 403 on suspended tenant
- Provisioning state machine: each step transition, rollback logic on simulated failure
- `AuditService`: correct payload shape, INSERT called on mutations

**Integration tests (Jest + Docker Compose Postgres)**

`jest.globalSetup` starts a test Postgres instance. Each test suite provisions two tenant DBs using production provisioning code.

Critical isolation test:
```typescript
it('tenant A query cannot return tenant B rows', async () => {
  const clientA = await manager.getClient(tenantA.id)
  const clientB = await manager.getClient(tenantB.id)
  await clientB.employee.create({ data: employeeFixture })

  const result = await clientA.employee.findMany()
  expect(result).toHaveLength(0)
})
```

Additional: provisioning pipeline happy path (CREATE_DB → DONE), each failure step triggers correct compensating actions, migration fan-out script runs cleanly against two tenant DBs.

**E2E tests (Playwright)**
- Signup flow: form → progress screen → DONE (Keycloak calls mocked via WireMock in CI)
- Auth isolation: user authenticated on `tenant-a.localhost` receives 403 on `tenant-b.localhost` routes even with a valid tenant-A token
- Proof-of-stack: ADMIN_KLIENTA logs in → employees list loads (empty) → no console errors

**CI pipeline order:** unit → integration → E2E. Each stage must pass before the next runs. Migration fan-out script runs as final CI step against integration test DBs before any deploy proceeds.

---

## RBAC Summary

| Role | Scope | Capabilities |
|------|-------|-------------|
| Pracownik | Own records | View own profile, own schedule, submit leave requests |
| Manager | Assigned unit | View/manage team records, approve team leave, set team schedule |
| HR | Whole tenant | Manage all employees, all leave, reports |
| Admin klienta | Whole tenant | All HR capabilities + user/access management, billing |
| Admin globalny | Control plane | Cross-tenant access, provisioning management (HRobot SaaS operator) |

---

## RODO / EU AI Act Compliance Notes

- PESEL encrypted at application layer before every write; never logged
- Audit log append-only with Postgres-enforced immutability
- Tenant data physically isolated — no cross-tenant DB access possible
- Short access token TTL + refresh token rotation in Keycloak realm config
- Data residency: all infrastructure in EU region (Terraform enforced)
- EU AI Act: AI agents (Grafik Manager, Analityk HR, Voice Agent) are deferred to post-Foundation sub-projects; DPIA required before AI features go live

---

## Not in scope (design review)

- Landing/marketing page design — Foundation ships a minimal `/` redirect to `/signup`; landing page is a separate sub-project
- Email templates (invite email, ops alert email) — visual design deferred; Foundation only specifies the trigger points
- Onboarding tour / product walkthrough — setup checklist on dashboard covers first-session orientation; full tour is post-MVP
- Dark/light mode toggle — Navy theme is fixed; no theme switching in Foundation

## What already exists (design system)

All components below exist in `C:\WORKSPACE\startup\demo\` and migrate verbatim:

| Component | Path | Status |
|-----------|------|--------|
| Button | `components/ui/Button.tsx` | Migrate as-is |
| Card | `components/ui/Card.tsx` | Migrate as-is |
| Badge | `components/ui/Badge.tsx` | Migrate as-is |
| Input | `components/ui/Input.tsx` | Migrate as-is |
| Modal | `components/ui/Modal.tsx` | Migrate as-is |
| SkipLink | `components/ui/SkipLink.tsx` | Migrate as-is |
| Sidebar | `components/layout/Sidebar.tsx` | Migrate + extend: add grouped nav, mobile drawer |
| TopBar | `components/layout/TopBar.tsx` | Migrate + wire to real auth |

New components added by Foundation: `SignupForm`, `SlugInput` (with live preview), `ProvisioningStatus`, `WelcomeDashboard`, `EmptyState`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score: 4/10 → 9/10, 10 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** Design Review CLEARED — eng review required before implementation.
