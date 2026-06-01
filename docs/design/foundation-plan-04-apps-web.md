# Foundation Plan 4 — `apps/web` (Next.js tenant panel + signup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. This plan is **proposed** — run it through the project's
> plan review (`/autoplan` or `/plan-eng-review` + `/plan-design-review`) before merging to `main`.

**Goal:** Scaffold `apps/web` as the production **Next.js 16 App Router** application — the
self-serve **signup site** and the **tenant HR panel** — built directly on the already-merged
design system **web-kit** (`docs/design/web-kit/`, see [/DESIGN.md](../../DESIGN.md)), wired to the
live **control-plane** (`apps/control-plane`) and **tenant-runtime** (`apps/tenant-runtime`) APIs via
**Auth.js v5 + Keycloak** with **subdomain-based tenant routing**.

**Relationship to the existing `apps/web`:** the current `apps/web` is the dependency-free
onboarding **demo SPA** (restyled to the system) — explicitly "not the full HR product UI". This
plan delivers that product UI. **Decision needed (T0):** keep the demo SPA as `apps/web-demo/`
(handy for tours/QA) or retire it; do not leave two things named `apps/web`.

---

## Architecture

- **Next.js 16 App Router**, TypeScript strict, **Tailwind v3** + tokens from the web-kit.
- **Route groups:** `(marketing)` (no auth, no shell) and `(tenant)` (auth gate + `AppShell`).
- **Subdomain tenant routing** in `middleware.ts`: `acme.hrobot.ai` → resolve tenant via a
  Redis-cached control-plane lookup → set `x-tenant-id` + `x-keycloak-realm` request headers;
  `status != ACTIVE` → 503 page; apex/`www` → marketing.
- **Auth.js v5 (NextAuth)** OIDC against Keycloak with the **realm selected dynamically** from the
  subdomain (`hrobot-{slug}`); `jwt`/`session` callbacks carry `hrobot_roles`.
- **Data:** Server Components fetch from the APIs with the user's bearer token. PESEL never reaches
  the browser (tenant-runtime returns masked/last-4 only).
- **UI:** the web-kit is the component layer (no re-implementation) — `AppShell`, `Sidebar`,
  `TopBar`, dashboard panels, `SlugInput`, `PasswordField`, `ProvisioningStatus`, `EmployeesTable`,
  `EmptyState`, `StubScreen`, the tokens + fonts.

## Tech stack

`next@16`, `react@19`, `react-dom@19`, `next-auth@5` (Auth.js v5), `tailwindcss@3` + `postcss` +
`autoprefixer`, `clsx`, `tailwind-merge`, `zod` (+ `@hrobot/shared` DTOs/enums), `ioredis` (tenant
cache, shared with the API), `zxcvbn` (password strength), Playwright (E2E). Self-hosted fonts
(Fontshare Cabinet Grotesk + General Sans, Google IBM Plex Mono) per the web-kit README.

## Scope

**Included:** signup + live slug check + async provisioning status; Auth.js + Keycloak dynamic
realm; subdomain middleware; auth-gated tenant shell; welcome dashboard; Pracownicy proof-of-stack
(real `GET /employees`) + onboarding empty state; module stubs (Grafik/Wnioski/Dostępy/Ustawienia/
Użytkownicy); Keycloak theme deployment; Dockerfile + compose `web` service; Playwright E2E.

**Excluded (later plans):** HR module business logic (employee CRUD, scheduling, leave, access),
AI agents, mobile app, external integrations, billing.

## Prerequisites (already on `main`)

- ✅ web-kit (`docs/design/web-kit/`) — drop-in components, tokens, mock API routes (endpoint shapes).
- ✅ Keycloak login theme (`docs/design/keycloak-theme/`) — deployed in T7.
- ✅ `apps/control-plane` + `apps/tenant-runtime` APIs (Plans 2-3) — signup, slug check, provision
  status, global login; tenant employees + onboarding checklist.
- ✅ `DESIGN.md` (repo root) — the source of truth; QA against it.

---

## Tasks

### T0 — Decide the demo-SPA fate + scaffold `apps/web`
- [ ] Decision: move current `apps/web` → `apps/web-demo/` (keep) **or** remove it. Update
      `serve.mjs`/launch refs and `docker-compose` accordingly.
- [ ] `create-next-app` (App Router, TS, Tailwind, ESLint, `src/`-less) at `apps/web`; register in
      `pnpm-workspace.yaml` (already `apps/*`); `turbo.json` build/lint/test wiring.
- [ ] Copy the web-kit in: `app/globals.css`, `app/fonts.ts`, `tailwind.config.ts`, `lib/`,
      `components/`, and the example pages; add `clsx tailwind-merge`; set tsconfig `@/*` alias.
- [ ] Self-host fonts: download the Fontshare woff2 into `app/fonts/` (web-kit README §4); wire
      `fontVars` onto `<html>` in the root layout.
- **Verify:** `pnpm --filter @hrobot/web dev` renders the web-kit dashboard at `/dashboard` with the
  real fonts; `pnpm --filter @hrobot/web build` passes the type-check.

### T1 — Subdomain tenant middleware (`middleware.ts`)
- [ ] Extract subdomain from `host`; apex/`www` → marketing. For a tenant subdomain, look up
      `{ tenantId, status, realmName }` from Redis (5-min TTL), cache-miss → control-plane API.
- [ ] `status != ACTIVE` → rewrite to a `/suspended` 503 page. Set `x-tenant-id` + `x-keycloak-realm`
      request headers for downstream Server Components / Route Handlers.
- **Verify:** unit test the resolver (apex→marketing, active→headers set, suspended→503, Redis
  error→control-plane fallback). E2E: `acme.localhost` resolves, unknown subdomain 404/landing.

### T2 — Auth.js v5 + Keycloak dynamic realm (`auth.ts`)
- [ ] `NextAuth((req) => …)` selecting the realm from `x-keycloak-realm`; `Keycloak` provider with
      `issuer = {KEYCLOAK_URL}/realms/{realm}`. `jwt` callback copies `profile.hrobot_roles` → token;
      `session` callback exposes `session.user.roles`.
- [ ] `(tenant)/layout.tsx` auth gate: `const s = await auth(); if (!s) redirect('/api/auth/signin')`.
- **Verify:** E2E sign-in via a mocked Keycloak (WireMock) yields a session with roles; unauth hits
  the tenant route → redirected to sign-in.

### T3 — Server API client (`lib/api.ts`)
- [ ] Typed fetch helpers to control-plane (`/api/*`) and tenant-runtime, attaching the bearer token
      for tenant calls; share DTOs/enums from `@hrobot/shared`. Endpoints: `slugs/check/:slug`,
      `auth/signup` (202 jobId / 409), `provision/status/:jobId`, tenant `employees`,
      `tenants/me/onboarding-checklist`.
- **Verify:** unit tests with fetch mocked (202/409/403 paths); never logs/returns PESEL.

### T4 — Marketing routes `(marketing)`
- [ ] `/` → redirect to `/signup` (Foundation: minimal landing).
- [ ] `/signup` — web-kit `SignupForm` (SlugInput debounced `slugs/check`, PasswordField via zxcvbn)
      → `POST /api/auth/signup` → `/signup/status?job=…`; 409 → inline slug error.
- [ ] `/signup/status` — web-kit `ProvisioningStatus` polling `provision/status/:jobId` every 3s →
      DONE redirects to the tenant subdomain; FAILED state with support contact.
- **Verify:** E2E signup → status (steps advance, mocked) → DONE; 409 shows "Ta nazwa jest już zajęta".

### T5 — Tenant routes `(tenant)`
- [ ] `layout.tsx` → auth gate + `AppShell` (props from session + tenant context).
- [ ] `dashboard/` → web-kit dashboard (greeting, quick actions, setup checklist bound to
      `onboarding-checklist`, Ochrona danych panel).
- [ ] `pracownicy/` → **proof-of-stack**: real `GET /employees` (tenant token) → `EmployeesTable`;
      empty → `EmployeesEmpty`. Validates subdomain→middleware→Auth.js→bearer→tenant-runtime→UI.
- [ ] `grafik`, `wnioski`, `dostepy`, `ustawienia`, `ustawienia/uzytkownicy` → web-kit `StubScreen`
      (RBAC-visible per `lib/nav`).
- **Verify:** E2E ADMIN_KLIENTA → dashboard → pracownicy loads (empty), no console errors; cross-
  tenant token → 403.

### T6 — Keycloak theme deployment
- [ ] Bake `docs/design/keycloak-theme/` into the Keycloak image / mount at `/opt/keycloak/themes/hrobot`;
      set the realm **login theme = `hrobot`** in the `KEYCLOAK_SETUP` provisioning step (Admin REST).
- [ ] Validate against the deployed Keycloak version (classic `keycloak` vs `keycloak.v2`) per the
      theme README; add the wordmark/logo asset + `login.ftl` if full branding is required.
- **Verify:** first-login screen renders in HRobot Navy/teal, not stock Keycloak.

### T7 — Container + CI
- [ ] Multi-stage Dockerfile (Next standalone output); profile-gated compose `web` service (depends on
      control-plane/tenant-runtime); env via `@hrobot/config` Zod schema (crash-on-missing).
- [ ] CI: `lint` → `typecheck` → `build` → `test` (unit) → Playwright E2E (Keycloak mocked). Block on red.
- **Verify:** `docker compose --profile full up` serves the app same-origin to the APIs; CI green.

---

## Definition of Done
- `pnpm --filter @hrobot/web build` + type-check green; all Playwright E2E pass.
- Signup → provisioning → ACTIVE → first login (HRobot Keycloak theme) → dashboard works end-to-end.
- ADMIN_KLIENTA lands on the welcome dashboard; Pracownicy shows the onboarding empty state (not
  "No items found"); cross-tenant access → 403; mobile drawer works at 375px.
- UI matches `DESIGN.md` (no glassmorphism / Inter / neon); `/design-review` clean.
- Demo-SPA fate resolved (T0); no duplicate `apps/web`.

## Risks / open decisions
- **Next 16 + Auth.js v5 + Keycloak** dynamic-realm-per-request is the riskiest seam — spike T2 first.
- **Fonts:** ship self-hosted woff2 (no CDN dependency in prod).
- **Tailwind v4?** web-kit config is v3; if the repo standardizes on v4, port `theme.extend` to
  `@theme` (values identical) — decide before T0.
- **Redis tenant cache invalidation** on suspend/deprovision (mirror the tenant-runtime fix P3-5).

## Cross-references
- Design system: [/DESIGN.md](../../DESIGN.md) · web-kit: [web-kit/README.md](web-kit/README.md) ·
  screens: [screens-and-components.md](screens-and-components.md) · Keycloak theme:
  [keycloak-theme/README.md](keycloak-theme/README.md) · mockups: [mockups/](mockups/).
- Foundation design spec (route structure, middleware, Auth.js, RBAC, proof-of-stack):
  `docs/superpowers/specs/2026-05-27-hrobot-foundation-design.md` §7.
- Prior plans: Foundation 01 (data layer), 02 (control-plane), 03 (tenant-runtime).

## Eng review decisions (locked — /plan-eng-review)

These supersede the matching task text above; fold them in at implementation time.

- **D1 — Spike auth first (gate).** Carve T2 (Auth.js v5 + Keycloak realm-per-subdomain) out as a
  standalone de-risk spike that must log in end-to-end (a mocked realm AND a real Keycloak realm)
  BEFORE T4-T8 build on it. Also gate on the existing TODO "Keycloak dev admin-client automation" so
  signup → DONE actually runs (today the pipeline parks before KEYCLOAK_SETUP without it).
- **Issue 1 (P1) — Edge-safe tenant resolution.** Middleware must NOT use `ioredis` (it runs on the
  Edge runtime). T1 resolves via a `fetch` to a new control-plane `GET /api/tenants/resolve/:slug`
  (Redis-cached + suspend/deprovision-invalidated server-side, reusing the P3-5 fix). Add a short
  Next `fetch` revalidate (~30-60s) on that call so it is not a hop per request.
- **Issue 2 (P2) — Host-only auth cookies.** Configure Auth.js v5 cookies with NO `domain` attribute,
  so a session is scoped to exactly its tenant subdomain (defense-in-depth isolation). Test asserts
  the cookie does not cross subdomains.
- **Issue 3 (P2) — Tailwind v4.** Scaffold apps/web on Next 16's default Tailwind v4; port the
  web-kit `theme.extend` into a CSS `@theme` block (values identical; mapping in the web-kit README)
  and re-verify the screens render.
- **Issue 4 (P2) — Fail-closed middleware.** If the resolve fetch fails (control-plane unreachable),
  middleware rewrites to a 503 "temporarily unavailable" page — never serve a tenant shell without
  confirming ACTIVE. + test.

**Test gaps to add to T8** (coverage diagram: ~31% named → target 100%): suspended → 503;
host-only-cookie isolation; signup 409 inline error; double-click resubmit; provisioning FAILED
state; unauth → redirect; employees empty-state; PESEL never returned/logged; provisioning
DONE → subdomain redirect; poll-stop after N checks; resolver-failure → 503. No regressions (new app).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | Scope OK (reuses web-kit, not greenfield). 3 architecture + 1 test/failure-mode decisions locked (Edge-safe resolve, host-only cookies, Tailwind v4, fail-closed middleware) + D1 spike-first gate. Coverage 31% → 100% gaps folded into T8. 0 critical silent gaps remaining. |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** Eng Review CLEARED — Plan 4 ready to implement. Sequence: spike T2 auth first (D1), then T0-T8. Design Review optional (the UI is the already-built web-kit). CEO Review optional (no new product scope — this is the planned Foundation web app).
