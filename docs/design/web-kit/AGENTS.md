# web-kit — agent notes

The runnable Next.js 15 (App Router) reference app for the HRobot design system. See `README.md`
for the design-system origin and the file map.

## Standalone app — NOT a pnpm workspace member

`pnpm-workspace.yaml` covers only `apps/*` + `packages/*`, so this app resolves deps on its own.
Always use `--ignore-workspace` here, or pnpm installs the repo root workspace instead and leaves
`node_modules` empty:

```
cd docs/design/web-kit
pnpm install --ignore-workspace     # writes web-kit/node_modules + pnpm-lock.yaml
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest (node env; lib/**/*.test.ts)
pnpm build            # next build (also type-checks routes/RSC)
pnpm dev              # next dev on :5601
```

## Two gates, one rule: nothing acts on tenant data without a session

`middleware.ts` gates BOTH halves of the app, and `lib/api-gate.ts` is the shared policy both the
middleware and the proxy read — never restate its rules in a second place.
- Tenant SCREENS: explicit prefix list → no `hrobot_token` cookie → 307 to `/login`. New screen under
  `app/(tenant)/` ⇒ add a matcher entry; `lib/middleware-matcher.test.ts` fails if you forget.
- The BFF: `'/api/:path*'` → no caller credential (Authorization header or `hrobot_token` cookie) →
  **401 JSON, handler never runs**. Default-closed, so a new route under `app/api/` is protected
  automatically. Exemptions are named in `PUBLICZNE_API` (only the three pre-auth signup mocks) and
  pinned exactly by `lib/api-gate.test.ts`.
- Second layer: the AMBIENT service credentials (minted Keycloak token, `TENANT_RUNTIME_DEV_TOKEN`)
  are opt-in via `HROBOT_ALLOW_AMBIENT_TOKEN`, so even a route that escapes the gate cannot make the
  BFF lend its own identity to an anonymous caller. Only the local demo launchers set it.

## Real backend wiring (grafik grid, M2-A5)

The grafik module talks to the real tenant-runtime (NestJS) API — no mock data:
- Browser client `lib/grafik.ts` → same-origin Next route handlers under `app/api/grafik/[...path]`
  and `app/api/employees` → `lib/tenant-runtime.ts` proxy → `${TENANT_RUNTIME_URL}/…`.
- The proxy is server→server (no CORS) and forwards a Keycloak bearer resolved in priority order:
  `Authorization` header → `hrobot_token` cookie → *(only with `HROBOT_ALLOW_AMBIENT_TOKEN`)* minted
  Keycloak token → legacy `TENANT_RUNTIME_DEV_TOKEN` → 401. The first two come from
  `readCallerCredential` in `lib/api-gate.ts`. See `.env.example`. tenant-runtime derives the tenant
  from the JWT issuer, so a valid token is all the backend needs.
- The minted token comes from `lib/keycloak-token.ts` — a server-only direct-grant (password) flow
  gated on the four `KEYCLOAK_*` env vars; it caches the JWT in module scope and auto-refreshes it
  before the ~300s expiry (or on a backend 401). Unset any var → provider is a no-op. Note the
  failure modes differ in the log: a *silent* null means `readConfig()` saw an unset var, while any
  actual grant failure logs `[keycloak-token] …`. Never hardcode creds; keep them in a gitignored
  `.env.local` (Next reads it from `docs/design/web-kit/`, at process start — copy it in BEFORE
  launching, not after).
- web-kit DOES have a login flow: `lib/auth-actions.ts` `login` is a server action doing the direct
  grant and setting the httpOnly `hrobot_token` + `hrobot_refresh` cookies. It is not an API route,
  so it needs no gate exemption. Wiring logic is covered by `lib/tenant-runtime.test.ts` +
  `lib/keycloak-token.test.ts` + `lib/grafik.test.ts`.

Reuse this proxy pattern (`proxyToTenantRuntime`) for any future real backend calls from web-kit.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
