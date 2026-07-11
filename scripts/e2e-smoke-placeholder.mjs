#!/usr/bin/env node
// TODO(M2-B4): Replace this placeholder with the real Playwright smoke lane.
//
// The `test:e2e:smoke` turbo target is scaffolded now so the CI graph resolves
// green, but the actual browser smoke (Playwright driving the app against the
// docker-compose / staging stack) is a downstream task (M2-B4) that depends on
// staging being up. Until then this no-op keeps the lane wired and passing.
//
// When M2-B4 lands, move this target off the workspace root (the `//#test:e2e:smoke`
// entry in turbo.json + the root `test:e2e:smoke` script) into a dedicated web
// e2e package (e.g. apps/web-e2e once apps/web ships as the Next.js web-kit) and
// run `playwright test` there. Remember to regenerate pnpm-lock.yaml when adding
// that new workspace package + its Playwright dependency.
console.log('[test:e2e:smoke] placeholder — no browser smoke yet (see TODO(M2-B4)). PASS.')
process.exit(0)
