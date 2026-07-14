# Staging environment — self-hosted runner setup

How the HRobot **staging** environment is deployed and how to bring the self-hosted runner online.
Staging is an always-on stack on the dev's Windows box, auto-updated from green `main` and exposed at
a stable Cloudflare URL. It is the last gate before UAT (spec §5, acceptance ENV-1..ENV-3).

> **Registration is a one-time human/captain step.** This doc describes it; the deploy workflow does
> not (and cannot) register a runner or provision secrets for you.

## What the deploy does

`.github/workflows/deploy-staging.yml` fires on `workflow_run` after the **`ci`** workflow
(`.github/workflows/ci.yml`) completes, and — only for a **successful**, **`main`**, **non-fork** run —
does, on the `staging-dev-box` runner:

1. Checkout the green `main`.
2. `docker compose up -d --build` with the **`full`** profile (control-plane :3000, tenant-runtime
   :3001, optimizer :8000 + postgres, redis, rabbitmq, keycloak). Reuses the repo's existing
   `docker-compose.yml` unchanged.
3. Migrate control-plane, then fan-out-migrate every tenant DB — **run inside the control-plane
   container** so the compose-internal `postgres` hostname and the encryption key resolve.
4. Ensure a canonical `staging` tenant exists (real signup → provisioning), then seed the frozen
   synthetic UAT dataset into it (idempotent).
5. (Re)start the runner-side **web front** (`apps/web`) and the **Cloudflare named tunnel**.
6. Health-check every service; fail loudly with a per-service report if any is down.

DB-touching steps run **in-container** on purpose: tenant DB URLs are stored encrypted with the
compose network host (`postgres`), which the Windows host cannot resolve. The container has the full
monorepo at `/app` (pnpm, Prisma, tsx, built `dist/`), so the canonical scripts run there as-is.

## Prerequisites on the box

- **Windows** with **Docker Desktop** (Linux containers), set to **start at logon**.
- **Git for Windows** — provides `git` **and Git Bash**; the workflow's `run:` steps use `bash`.
- **Node 22+** on `PATH` (runs the zero-dependency web front + health-check; no pnpm needed on the host).
- **cloudflared** on `PATH` (`winget install --id Cloudflare.cloudflared`).

## 1. Register the self-hosted runner (non-privileged)

Run as a **normal, non-admin user** — a self-hosted runner must never execute untrusted code with
elevated rights, and the deploy needs no admin.

1. GitHub → repo **Settings → Actions → Runners → New self-hosted runner** (Windows x64). Follow the
   shown `config.cmd` download/configure steps.
2. When configuring, add the label **`staging-dev-box`** (the workflow targets
   `runs-on: [self-hosted, staging-dev-box]`). Scope the runner to **this repo only**.
3. Run it as the logged-in user (`run.cmd`), or install the runner service under a non-privileged
   account. Do **not** run it as Administrator.

Hardening (spec §9): this runner serves `twilk/HRobotAI` only, runs as a limited user, and holds **no
production secrets**. The workflow's `if:` gate additionally blocks fork/non-main/failed triggers.

## 2. Secrets & configuration — never commit these

### a. Runner `.env` (repo root on the box, git-ignored)

`docker-compose.yml` loads `.env` into the app containers (`env_file`). Create it **once** from
`.env.example` with **staging-only** values (see `.env.example` for the full list):

- `TENANT_DB_ENCRYPTION_KEY` — 32-byte AES key, **64 hex chars**: `openssl rand -hex 32`. The same key
  encrypts tenant DB URLs and the seed's PII; keep it stable or existing ciphertext stops decrypting.
  The in-container migrate/seed steps inherit it from this file — the workflow never handles it.
- `KEYCLOAK_ADMIN_CLIENT_SECRET`, `KEYCLOAK_CLIENT_ID` — the admin client the `KEYCLOAK_SETUP`
  provisioning step authenticates as (see the repo `README.md` → *Keycloak*). Provisioning a tenant
  fails here if these are wrong, and the deploy's "Ensure staging tenant" step will time out.
- `GLOBAL_ADMIN_JWT_SECRET`, `NEXTAUTH_SECRET` — long random values.

Use a fresh `TENANT_DB_ENCRYPTION_KEY` for staging; **do not reuse any production key** on a private
box (RODO/spec §9). The synthetic seed hard-refuses any non-synthetic PESEL, so only fictional data is
ever written.

### b. GitHub Actions secret

- **`CLOUDFLARE_TUNNEL_TOKEN`** — repo **Settings → Secrets and variables → Actions**. Consumed only by
  `infra/deploy/edge-up.sh` to run the named tunnel. See step 3. Without the secret `edge-up.sh`
  degrades to a **quick tunnel** (session-scoped URL, logged to `.staging-run/cloudflared.log`) —
  the deploy stays green, but the URL changes per session until the named tunnel is configured.

### c. Shared-box layout (registered 2026-07-14 on the dev box)

The box also runs the live demo stack (compose project `hrobot`) and unrelated projects holding the
default host ports. The staging deploy therefore runs as its **own compose project with fresh
volumes** and a remapped 48xx port lane — it never adopts or restarts the live demo stack:

- `_work/HRobotAI/HRobotAI/.env` — copy of the dev `.env` **plus `COMPOSE_PROJECT_NAME=hrobot-staging`**;
- `_work/HRobotAI/HRobotAI/docker-compose.override.yml` — backing services unpublished; control-plane
  `4800:3000`, tenant-runtime `4801:3001`, keycloak 26.0 `4881:8080` with a project-scoped volume;
- runner-root `.env` (`C:\actions-runner-hrobot\.env`) — job-level env consumed by the workflow and
  scripts: `CP_URL`/`TR_URL`/`KEYCLOAK_URL` (48xx), `CONTROL_PLANE_ORIGIN`/`TENANT_RUNTIME_ORIGIN`
  (the web front's proxy targets).

Both workdir files survive checkouts because `deploy-staging.yml` checks out with `clean: false`
(the default `git clean -ffdx` would delete these git-ignored operator files).

## 3. Create the Cloudflare **named** tunnel (stable URL)

A named tunnel keeps the **same public URL across restarts** (ENV-2), so a redeploy never changes the
UAT link.

1. `cloudflared tunnel login`
2. `cloudflared tunnel create hrobot-staging`
3. In the **Cloudflare Zero Trust dashboard → Networks → Tunnels**, open `hrobot-staging` and add a
   **Public Hostname** (e.g. `staging.<your-domain>`) routed to the service **`http://localhost:5173`**
   (the web front). This is the stable staging URL.
4. Copy the tunnel's **token** from the dashboard and store it as the GitHub Actions secret
   `CLOUDFLARE_TUNNEL_TOKEN`. The workflow runs `cloudflared tunnel run --token <token>`; ingress is
   managed remotely, so no local config file is needed.

> Alternative (credentials-file tunnel): keep `~/.cloudflared/<UUID>.json` + a `config.yml` with an
> `ingress` rule to `http://localhost:5173`, and run `cloudflared tunnel run hrobot-staging`. The
> token approach above is simpler and keeps the credential in one secret.

## 4. Always-on across reboots

The Docker stack is owned by the Docker daemon and survives job completion. The **web front** and
**cloudflared** are runner-side processes; the deploy (re)starts them each run via
`infra/deploy/edge-up.sh` (detached, idempotent, tracked by pidfiles under `.staging-run/`). To keep
them up after a **reboot** without waiting for the next deploy, register a **logon Task Scheduler**
task (non-privileged) that runs, in the repo root:

```
CLOUDFLARE_TUNNEL_TOKEN=<token> bash infra/deploy/edge-up.sh
```

Ensure Docker Desktop is also set to start at logon.

## 5. Going live — infra prerequisites

The workflow + scripts are complete, but live end-to-end validation needs three things outside this
PR's control:

- **GitHub Actions billing restored** — `ci.yml` currently can't run (hosted-minutes exhausted), so
  the `workflow_run` trigger never fires.
- **`ci.yml` merged to `main`** (PR #9) so the `workflow_run: workflows: ["ci"]` trigger resolves.
- **The runner registered** per step 1, with the `.env` + tunnel + secret from steps 2–3.

Once those clear, a merge to `main` → green `ci` → this workflow auto-deploys staging in ≤ ~10 min
(ENV-1). Manual fallback if the runner is offline (spec §9): from the box, `docker compose --profile
full up -d --build`, then run the migrate/seed/health steps that the workflow performs.

## Maintaining this file

Keep this doc to what an operator needs to bring staging up: runner registration, secrets/config, the
named tunnel, and the go-live prerequisites. For pipeline mechanics, point to
`.github/workflows/deploy-staging.yml` and the scripts under `infra/deploy/` rather than duplicating
them here.
