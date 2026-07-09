
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

`docs/design/web-kit` (the Next.js tenant reference app, port 5601) is NOT a pnpm-workspace member —
turbo won't build it. Install + build it standalone from that dir: `npm install && npm run build`
(build runs type-check). Its data is static/mock proof-of-stack (e.g. `lib/swaps.ts` stands in for the
tenant-runtime swap API); wire to real `fetch` when auth lands.

## Prisma enums

Prisma can't import TS, so enums are duplicated as TS const-objects and kept in sync by a
schema-parity test — see `packages/db/src/enumParity.test.ts` (shared enums) or
`apps/tenant-runtime/src/shift-swap/swap-state-machine.spec.ts` (a module-local enum). Add a
parity assertion whenever you mirror a new `enum` block.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
