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

## Real backend wiring (grafik grid, M2-A5)

The grafik module talks to the real tenant-runtime (NestJS) API — no mock data:
- Browser client `lib/grafik.ts` → same-origin Next route handlers under `app/api/grafik/[...path]`
  and `app/api/employees` → `lib/tenant-runtime.ts` proxy → `${TENANT_RUNTIME_URL}/…`.
- The proxy is server→server (no CORS) and forwards a Keycloak bearer token resolved in priority
  order: `Authorization` header → `hrobot_token` cookie → `TENANT_RUNTIME_DEV_TOKEN` env. See
  `.env.example`. tenant-runtime derives the tenant from the JWT issuer, so a valid token is all the
  backend needs.
- web-kit has **no login flow** yet (`components/auth/login-form.tsx` is a mock `router.push`), so a
  full live round-trip needs a real JWT + the compose stack. Wiring logic is covered by
  `lib/tenant-runtime.test.ts` + `lib/grafik.test.ts`.

Reuse this proxy pattern (`proxyToTenantRuntime`) for any future real backend calls from web-kit.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
