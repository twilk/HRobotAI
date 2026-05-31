# TODOS

Deferred items surfaced by `/autoplan`. Items here are NOT in the current plan's scope;
they are parked decisions or follow-up work. Merge-blocking fixes live in the plan file's
review report, not here.

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
      `max_connections`. Set explicit per-tenant `connection_limit`; document the aggregate ceiling.

### Audit model decision
- [ ] Decide audit coverage for **control-plane** mutations (onboarding PATCH writes the
      control-plane DB, not a tenant DB — the tenant-client-only AuditInterceptor can't audit it).

## Developer experience (Plan 2 first-run — surfaced 2026-05-31)

- [ ] **Keycloak dev admin-client automation.** First-run docker-compose boots Keycloak with
      `admin/admin`, but the provisioning `KEYCLOAK_SETUP` step needs a confidential admin client
      (`KEYCLOAK_CLIENT_ID` / `KEYCLOAK_ADMIN_CLIENT_SECRET`) that must currently be created by hand.
      Ship a realm/client import (`--import-realm` or a bootstrap script) so signup → DONE works with
      zero manual Keycloak setup. Until then the pipeline parks before `KEYCLOAK_SETUP`.
- [ ] **Production Dockerfile for `apps/api`.** docker-compose provides backing services only; the API
      runs on the host via `pnpm dev`. A container image (+ compose service) is needed for CI/prod parity.

## Resolved 2026-05-31 (post-/autoplan, this session)

- [x] **H1 / M4 / C1–C5 / C4b** — Plan 2 security + correctness fixes committed + pushed to PR #2.
- [x] **C1 migration verified** — `next_attempt_at` migration applies cleanly against a real Postgres 16;
      durable-retry relay no longer relies on in-memory `setTimeout`.
- [x] **P3-1 / P3-4 / P3-5 / P3-7** — Plan 3 fixes (JWT issuer validation, PESEL redaction in audit_log,
      cache TTL 300→30s, `@TenantRoute()`) committed + pushed to PR #3.
- [x] **M7** — signup throttled to 5/min/IP (was the loose global 100/min default). PR #2.
- [x] **DX first-run** — docker-compose stack, `.env.example`, pgcrypto dev-admin seed, quickstart README.
      Verified end-to-end against a throwaway Postgres. PR #2.
