# HRobot — onboarding web app

A dependency-free single-page app that walks a new customer through **every function HRobot
exposes today**, with a guided **Shepherd.js** tour. It drives the real APIs (no mock backend):
the control-plane (signup, slug check, provisioning status, global-admin login) and the
tenant-runtime (employee directory, onboarding checklist).

## Run

```bash
# 1. Serve the app (no install needed — pure Node, zero deps).
node apps/web/serve.mjs            # -> http://localhost:5173

# 2. (Optional, for the LIVE flow) start the backends it proxies to:
#    control-plane on :3000, tenant-runtime on :3001.
docker compose up -d               # postgres, redis, rabbitmq, keycloak
pnpm --filter @hrobot/db migrate:control:deploy
pnpm --filter @hrobot/db seed:admin:dev
pnpm --filter @hrobot/api dev                              # control-plane :3000
PORT=3001 pnpm --filter @hrobot/api dev   # tenant-runtime (run from that worktree)
```

Open `http://localhost:5173`. The tour auto-starts on first visit; re-run it any time with
**Take the tour** (top-right). The header pill shows live API health.

## How it works

- **`index.html`** — the SPA: one card per function (claim URL → create workspace → provisioning
  → sign in → team → onboarding checklist).
- **`app.js`** — the API client and screen logic: slug check, signup, live provisioning polling
  (the `CREATE_DB → RUN_MIGRATIONS → SEED → KEYCLOAK_SETUP → DONE` state machine), login + JWT
  decode, employee directory, checklist. All API data is HTML-escaped before rendering.
- **`tour.js`** — the Shepherd.js guided tour, one step per function.
- **`serve.mjs`** — a tiny zero-dependency static server that reverse-proxies the API so the
  browser stays same-origin (no CORS, no backend changes): `/api/*` → control-plane (`:3000`),
  `/tapi/*` → tenant-runtime (`:3001`). Override with `WEB_PORT`, `CONTROL_PLANE_ORIGIN`,
  `TENANT_RUNTIME_ORIGIN`.

## Notes

- The employee directory and checklist are tenant-scoped and require a **tenant** Keycloak JWT
  (the global-admin token can't read tenant data — that isolation is intentional). When no tenant
  token is present, those screens explain this and offer clearly-labelled demo data so the tour
  still covers the function.
- PESEL (Polish national ID) is never sent to the browser by the employees endpoint (RODO).
- This is a demo/onboarding surface over the implemented foundation (Plans 1-3); it is not the
  full HR product UI.
