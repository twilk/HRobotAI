#!/usr/bin/env node
// CI-5 — real browser smoke lane (replaces scripts/e2e-smoke-placeholder.mjs).
//
// The smoke itself lives in apps/web (Playwright + the spec), because that is the app it drives.
// apps/web is a workspace package (@hrobot/web), so this root-level shim is what lets
// `pnpm turbo run test:e2e:smoke` reach it.
//
// Preflight, not just a spawn: Playwright needs a live stack (apps/web + Keycloak + tenant-runtime).
//   • app reachable        → run the smoke for real;
//   • app down, local dev   → SKIP with an explanation (a laptop with nothing running must not fail);
//   • app down, CI          → FAIL. A smoke gate that silently passes because nothing was running is
//                             worse than no gate at all.
//
// Point it elsewhere with E2E_BASE_URL (e.g. the staging URL).

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_KIT = path.resolve(__dirname, '..', 'apps', 'web')
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5601'
const IS_CI = Boolean(process.env.CI)

function skipOrFail(reason) {
  if (IS_CI) {
    console.error(`[test:e2e:smoke] FAIL — ${reason}`)
    console.error('[test:e2e:smoke] In CI the smoke must actually run. Start the stack or set E2E_BASE_URL.')
    process.exit(1)
  }
  console.log(`[test:e2e:smoke] SKIP — ${reason}`)
  console.log(`[test:e2e:smoke] Bring the stack up (docker compose -p hrobot --profile full up -d, front on ${BASE_URL}) to run it.`)
  process.exit(0)
}

async function isReachable(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    // Any HTTP answer means something is serving; /login is public so no auth is involved.
    await fetch(new URL('/login', url), { signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

if (!existsSync(path.join(WEB_KIT, 'node_modules', '@playwright', 'test'))) {
  skipOrFail(`Playwright is not installed in ${WEB_KIT} (run: pnpm install && npx playwright install chromium)`)
}

if (!(await isReachable(BASE_URL))) {
  skipOrFail(`nothing is answering at ${BASE_URL}`)
}

console.log(`[test:e2e:smoke] running Playwright smoke against ${BASE_URL}`)
const child = spawn('npx', ['playwright', 'test'], {
  cwd: WEB_KIT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, E2E_BASE_URL: BASE_URL },
})
child.on('exit', (code) => process.exit(code ?? 1))
