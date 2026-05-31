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

### Cross-plan blocker (verified in live worktree `hrobot-control-plane-api`)
- [ ] **Keycloak roles never produced.** Plan 2's `keycloak-setup.step.ts` creates realm/client/user
      but no roles, no role assignment, and no `hrobot_roles` protocol mapper → Plan 3's RBAC is
      unsatisfiable end-to-end (the tenant admin gets 403 on their own onboarding PATCH). Fix lives
      in Plan 2's Keycloak step. (A task chip was spawned for this.)

### Architecture gate (deferred — ties to held DB-per-tenant premise)
- [ ] **Connection-pool ceiling under DB-per-tenant.** `TenantPrismaManager` caches up to 100
      PrismaClients, each with its own pool (~5-17 conns) × N API pods → can exceed Postgres
      `max_connections`. Set explicit per-tenant `connection_limit`; document the aggregate ceiling.

### Audit model decision
- [ ] Decide audit coverage for **control-plane** mutations (onboarding PATCH writes the
      control-plane DB, not a tenant DB — the tenant-client-only AuditInterceptor can't audit it).
