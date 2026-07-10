
## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

## Build & type-check

Workspace packages must be built before an app type-checks/builds: a bare `nest build`/`tsc` in
`apps/*` fails with `Cannot find module '@hrobot/db'`. Use turbo so deps build first:
`npx turbo run build --filter=@hrobot/<pkg>` (it also runs `db:generate`). Same for lint/test order.

The top-level `agent/` dir (`@hrobot/agent`, added to `pnpm-workspace.yaml`) is a pnpm-workspace
member but typecheck-only: no `dist`, `build` is `tsc --noEmit`, code runs via `tsx`. It holds the
M2-C1 phase-A cold-start dataset generator — see `agent/README.md`. The eventual Python/SB3 agent
service is a separate runtime and does NOT live here.

`docs/design/web-kit` (the Next.js tenant reference app, port 5601) is NOT a pnpm-workspace member —
turbo won't build it. Install + build it standalone from that dir: `npm install && npm run build`
(build runs type-check). Its data is static/mock proof-of-stack (e.g. `lib/swaps.ts` stands in for the
tenant-runtime swap API); wire to real `fetch` when auth lands.

## Prisma enums

Prisma can't import TS, so enums are duplicated as TS const-objects and kept in sync by a
schema-parity test — see `packages/db/src/enumParity.test.ts` (shared enums) or
`apps/tenant-runtime/src/shift-swap/swap-state-machine.spec.ts` (a module-local enum). Add a
parity assertion whenever you mirror a new `enum` block.

## Staging deploy pipeline

`.github/workflows/deploy-staging.yml` (+ scripts in `infra/deploy/`, doc `docs/infra/staging-runner.md`)
deploys staging on the self-hosted `staging-dev-box` runner after the `ci` workflow goes green on
`main`. Non-obvious: DB migrate/seed steps run **inside** the control-plane container
(`docker compose exec … --workdir /app`), not on the host — tenant DB URLs are encrypted with the
compose-internal `postgres` hostname (unreachable from the host) and the container carries the same
`TENANT_DB_ENCRYPTION_KEY` (from `.env`) that encrypted them. The web front (`apps/web`) and the
Cloudflare named tunnel are **not** compose services (governance: don't edit `docker-compose.yml`);
they run runner-side via `infra/deploy/edge-up.sh`.

## Python/ML services & docker.exe

The Python services (`grafik-optimizer/` = lean CP-SAT; `agent-service/` = RL/imitation, a
**distinct** image — never merge their deps) build on `python:3.12-slim` (SB3/ortools/torch have no
CPython ≥ 3.13 wheels). On the WSL host use **`docker.exe`** (Windows binary → Docker Desktop
daemon), not `docker`; there is no usable host Python. `docker.exe` chokes on this repo's WSL
symlinks (every `CLAUDE.md` → `AGENTS.md`), so each build context's `.dockerignore` MUST exclude
`**/CLAUDE.md`. Both services consume the FROZEN grafik contract via an own pydantic mirror +
parity test (same schema-parity idiom as *Prisma enums* above) — see each service's `README.md`.
Note the TS `agent/` dir (cold-start dataset gen, above) is a different thing from `agent-service/`.
`agent-service`'s M2-C2 feedback/policy persist in a tenant-keyed SQLite store owned in-service
(`AGENT_DB_PATH`); the Prisma `AgentFeedback` home (spec §6) is deferred to a separate change.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
