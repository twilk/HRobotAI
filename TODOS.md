# TODOS

Deferred items surfaced by `/autoplan`. Items here are NOT in the current plan's scope;
they are parked decisions or follow-up work. Merge-blocking fixes live in the plan file's
review report, not here.

## Consolidation — `main` trunk (2026-06-01)

- [x] **All five feature branches consolidated into `main`** (default branch): two services
      (`apps/control-plane`, `apps/tenant-runtime`) + `apps/web` on the hardened data layer.
      `pnpm build` + 114 unit tests green. PRs #1-#5 closed as superseded (branches kept).
- [x] **Container build fixed for the two-app layout** (`e7bee40`, `37da00e`): per-app
      Dockerfiles (paths/name corrected, `packages/db/prisma` copied before install for the
      `postinstall` db:generate, bcrypt check run from the app dir); compose now has profile-gated
      `control-plane` (:3000) + `tenant-runtime` (:3001). Both images build; tenant-runtime image
      verified booting (health live/ready ok).
- [x] **Boot-blocker fixed (found by booting the image, not by tests):** `@TenantRoute()`
      re-instantiates `TenantContextInterceptor` per host module, but `REDIS_FALLBACK_COUNTER`
      wasn't exported from the `@Global()` `TenantRuntimeModule` → app crashed at startup. Exported
      the token + prom counter. All 42 unit specs mocked the token, so only a real boot caught it.
- [ ] **End-to-end container boot of BOTH services via `docker compose --profile full up`** on a
      fresh stack (control-plane was verified in an earlier session; tenant-runtime verified now via
      `docker run`; the combined compose path + a real signup→DONE through the containers is the
      remaining check). Also: slim the 858MB images (`pnpm deploy --prod` / distroless).

## Foundation Plan 2 — Control Plane (review 2026-05-31)

### Deferred — foundation scope exclusion (premise P5, held by user)
- [ ] **Billing / trial gate.** Self-serve provisioning ships with no paywall, plan
      selection, trial expiry, or metering. Decide self-serve+billing vs sales-gated
      signup before public launch. (Both reviewers flagged.)

### Proposed at final gate (pending user decision — not auto-added)
- [ ] **DR / backup + tested restore** for per-tenant Postgres databases. DB-per-tenant
      makes "restore tenant #347 to 9am yesterday" an N-database problem with no current story.
- [ ] **`DEPROVISION` pipeline step + RODO Art. 17 erasure.** `TenantStatus.DEPROVISIONED`
      is an enum value with no implementing step; there is no tenant-delete path. Required
      for holding employee PII.
- [ ] **Per-tenant migration fan-out orchestrator** (routine-release path): status tracking,
      idempotent resume, parallelism control, mixed-version rollback policy. The provisioning
      `RUN_MIGRATIONS` step covers new-tenant only.

### Premise challenges (held by user at premise gate — carried for the record)
- [ ] Revisit **Keycloak realm-per-tenant → single-realm + Organizations** before ~1k
      tenants (scaling cliff; realm→org migration is brutal once users are live).
- [ ] Revisit **self-hosted Keycloak → managed auth** if ops attention becomes the bottleneck.
- [ ] Decouple the **slug** from subdomain/realm/`iss` and add a rename path (use tenant UUID
      for the realm identifier).

## Foundation Plan 3 — Tenant Runtime (review 2026-05-31)

### Cross-plan blocker — RESOLVED 2026-05-31
- [x] **Keycloak roles never produced.** ~~Plan 2's `keycloak-setup.step.ts` creates realm/client/user
      but no roles, no role assignment, and no `hrobot_roles` protocol mapper → Plan 3's RBAC is
      unsatisfiable end-to-end.~~ Fixed via C4b on PR #2 (`feat/control-plane-api`): the Keycloak step
      now creates one realm role per `@hrobot/shared` `Role`, registers an `oidc-usermodel-realm-role-mapper`
      emitting the top-level multivalued `hrobot_roles` claim, and assigns `ADMIN_KLIENTA` to the initial
      user (7 specs green). Plan 3 RBAC is now satisfiable end-to-end.

### Architecture gate (deferred — ties to held DB-per-tenant premise)
- [ ] **Connection-pool ceiling under DB-per-tenant.** `TenantPrismaManager` caches up to 100
      PrismaClients, each with its own pool (~5-17 conns) × N API pods → can exceed Postgres
      `max_connections`. Set explicit per-tenant `connection_limit`; document the aggregate ceiling;
      front Postgres with PgBouncer at scale. (The related in-flight-eviction correctness bug — LRU/TTL
      `$disconnect` aborting live queries — is FIXED on PR #1 via `withClient()` lease, `63eb310`.)

### Audit model decision
- [ ] Decide audit coverage for **control-plane** mutations (onboarding PATCH writes the
      control-plane DB, not a tenant DB — the tenant-client-only AuditInterceptor can't audit it).

## Developer experience (Plan 2 first-run — surfaced 2026-05-31)

- [ ] **Keycloak dev admin-client automation.** First-run docker-compose boots Keycloak with
      `admin/admin`, but the provisioning `KEYCLOAK_SETUP` step needs a confidential admin client
      (`KEYCLOAK_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET`) that must currently be created by hand.
      Ship a realm/client import (`--import-realm` or a bootstrap script) so signup → DONE works with
      zero manual Keycloak setup. Until then the pipeline parks before `KEYCLOAK_SETUP`.
- [x] **Production Dockerfile for `apps/api`.** ~~docker-compose provides backing services only.~~ Done on
      PR #2: multi-stage Dockerfile + profile-gated compose `api` service, verified booting end-to-end.
      (Image is ~854MB — slimming via `pnpm deploy --prod` / distroless is a future optimization.)

## Foundation Plan 1 — Monorepo & Data Layer (review 2026-06-01)

### Premise gate — reconsidered + confirmed
- DB-per-tenant + Keycloak realm-per-tenant + app-layer crypto: both reviewers (Claude + Codex),
  with no shared context, independently challenged these as unearned premises. User reconsidered
  shared-schema+RLS at the gate and re-affirmed DB-per-tenant. ADR + rejected-alternatives written
  into the plan file (`docs/superpowers/plans/2026-05-27-foundation-01-monorepo-data-layer.md`).

### Ripple — rebase the stacked PRs onto the hardened data layer (PR #1 @ `63eb310`)
- [ ] **Rebase #2 (control-plane-api), then #3 (tenant-runtime), onto `feat/foundation-data-layer`.**
      The hardening kept data-layer APIs backward-compatible (EncryptionService Buffer ctor,
      TenantPrismaManager `getClient` + `max`/`ttl` aliases all preserved), so consumer code compiles
      unchanged — the rebase only needs conflict resolution in `packages/*`: `env.ts` (URL-scheme
      refinements vs Plan 2's added vars + the in-flight `KEYCLOAK_ADMIN_PASSWORD` rename), the
      `clients.ts`/`index.ts` barrel rename, and `encryption.ts`. After rebase: `pnpm test` both + re-run
      the in-container boot. (Coordinate with the still-uncommitted Keycloak DX work on #2.)

### Forward notes (when employee CRUD lands — later plan)
- [ ] Employee create/update MUST use `@hrobot/db` `encryptEmployeePesel()` (sets the now-required
      `pesel_hash` blind index + AAD-binds the ciphertext); look up via `employeePeselBlindIndex()`.
      Never assign a plaintext `pesel`.
- [ ] Migrate the tenant-runtime request path from `getClient()` to `withClient()` so LRU/TTL eviction
      cannot `$disconnect` a client mid-query.

### Deferred (extends existing items)
- [ ] **audit_log retention / partitioning.** The append-only trigger (now incl. TRUNCATE) blocks
      deletion forever, which collides with RODO retention limits; pair with the DEPROVISION/Art.17
      erasure item and add time-partitioning so old partitions can be detached.
- [ ] **audit_log trigger integration test** against a real Postgres (INSERT ok; UPDATE/DELETE/TRUNCATE
      rejected). Only the SQL ships today; no automated DB-level assertion (unit suite can't cover it).
- [ ] **Two-key split + envelope/KMS.** One `TENANT_DB_ENCRYPTION_KEY` covers both db_url and PESEL.
      The versioned keyring now supports rotation; next step is separate per-purpose keys and
      KMS-backed envelope encryption before holding real PII.

## Resolved 2026-05-31 (post-/autoplan, this session)

- [x] **H1 / M4 / C1–C5 / C4b** — Plan 2 security + correctness fixes committed + pushed to PR #2.
- [x] **C1 migration verified** — `next_attempt_at` migration applies cleanly against a real Postgres 16;
      durable-retry relay no longer relies on in-memory `setTimeout`.
- [x] **P3-1 / P3-4 / P3-5 / P3-7** — Plan 3 fixes (JWT issuer validation, PESEL redaction in audit_log,
      cache TTL 300→30s, `@TenantRoute()`) committed + pushed to PR #3.
- [x] **M7** — signup throttled to 5/min/IP (was the loose global 100/min default). PR #2.
- [x] **DX first-run** — docker-compose stack, `.env.example`, pgcrypto dev-admin seed, quickstart README.
      Verified end-to-end against a throwaway Postgres. PR #2.
- [x] **apps/api containerized** — multi-stage Dockerfile + profile-gated compose `api` service. PR #2.
- [x] **Two latent boot-blockers fixed (found by actually booting the image — all-mocked tests missed both):**
      (a) `amqp-connection-manager` was missing → NestJS RMQ transport threw PackageNotFound and the API
      never started; (b) `bcrypt` was absent from `pnpm.onlyBuiltDependencies` → native addon never built,
      so `node dist/main` would crash on first login. Both fixed + verified (login returns a JWT in-container). PR #2.

## Resolved 2026-06-01 (Plan 1 /autoplan, this session)

- [x] **Plan 1 data-layer hardening** (PR #1, `63eb310`) — /autoplan CEO+Eng+DX, both models. Versioned-keyring
      encryption (rotation) + 12B IV + AAD + `fromHexKey` + typed `DecryptionError`; PESEL blind index
      (`pesel_hash` UNIQUE) + AAD-bound `encryptEmployeePesel`/`decryptEmployeePesel` guard-rail helpers;
      `TenantPrismaManager.withClient()` lease so eviction never drops in-flight queries + `disconnectAll()`;
      `migrateTenant` env allowlist (no more leaking the master key into the per-tenant subprocess);
      `runWithConcurrency` limit<1 guard; `parseEnv` URL-scheme validation; `audit_log` BEFORE TRUNCATE trigger;
      enum-parity guard test; barrel curation; docker port 5433↔.env fix; `postinstall` db:generate.
      **42 unit tests green (was 17).** Stacked PR rebase tracked above.
