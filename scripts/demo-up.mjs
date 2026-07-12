#!/usr/bin/env node
// One command: stopped stack → demo-ready. Brings the full compose stack up, waits for Keycloak +
// tenant-runtime, rebuilds the ephemeral demo realm, auto-applies the keycloak_sub sync the seed
// emits, and seeds the J5 pending swap. Prints the login table + the one manual step left (the
// web-kit UI, which is a separate host process by design).
//
//   node scripts/demo-up.mjs
//
// Overridable via env: KC_URL, TENANT_RUNTIME_URL, PG_CONTAINER, TENANT_DB.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KC = process.env.KC_URL || 'http://localhost:8081'
const TR = process.env.TENANT_RUNTIME_URL || 'http://localhost:3001'
const PG = process.env.PG_CONTAINER || 'hrobot-postgres-1'
const DB = process.env.TENANT_DB || 'hrobot_t_900d948b'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (m) => console.log(`\n▶ ${m}`)

/** Run a command inheriting stdio; throw on non-zero. */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`)
}

/** Pipe `input` into a container psql session (avoids shell-redirect portability issues). */
function psql(input) {
  const r = spawnSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', DB], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (r.status !== 0) throw new Error(`psql exited ${r.status}`)
}

async function waitFor(name, url, ok) {
  process.stdout.write(`⏳ ${name} `)
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(url)
      if (ok(res.status)) {
        console.log('✓')
        return
      }
    } catch {
      /* not up yet */
    }
    process.stdout.write('.')
    await sleep(2000)
  }
  throw new Error(`timed out waiting for ${name} at ${url}`)
}

async function main() {
  step('docker compose --profile full up -d')
  run('docker', ['compose', '-p', 'hrobot', '--profile', 'full', 'up', '-d'])

  step('waiting for services')
  await waitFor('keycloak', `${KC}/realms/master/.well-known/openid-configuration`, (s) => s === 200)
  // tenant-runtime is up as soon as it answers at all (an unauthenticated call returns 401).
  await waitFor('tenant-runtime', `${TR}/api/grafik/shifts`, (s) => s > 0)

  step('seeding demo realm (hrobot-staging)')
  const seed = spawnSync('node', ['scripts/seed-keycloak-demo.mjs'], { cwd: root, encoding: 'utf8' })
  process.stdout.write(seed.stdout || '')
  if (seed.status !== 0) {
    process.stderr.write(seed.stderr || '')
    throw new Error('seed-keycloak-demo failed')
  }
  // The seed emits `UPDATE users SET keycloak_sub=…` when Keycloak assigned new user ids (fresh
  // realm) that the tenant DB doesn't yet reference. Apply them so the employee-own-shifts query
  // (employee.user.keycloakSub === jwt.sub) resolves.
  const updates = (seed.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('UPDATE users SET keycloak_sub='))
  if (updates.length) {
    step(`syncing ${updates.length} keycloak_sub value(s) → ${DB}`)
    psql(updates.join('\n'))
  } else {
    console.log('  (keycloak_sub already in sync)')
  }

  step('seeding J5 pending swap')
  psql(readFileSync(join(root, 'scripts', 'seed-demo-swap.sql'), 'utf8'))

  console.log(`
✅ Demo backend ready.

   Logins (${'http://localhost:5601'} → /login):
     demo           / demo-staging-2026   ADMIN      full grafik + swap approval
     manager.demo   / Manager!2026        MANAGER    unit-scoped + approves swaps
     pracownik.demo / Pracownik!2026      PRACOWNIK  read-only "my schedule" (Anna Kowalska)

   Last step (separate host process by design):
     cd docs/design/web-kit && node start-live.mjs      # http://localhost:5601

   Demo week: 13–19 July 2026. Full script: data/m2-evidence/demo-scenario-4mobility.md
   NB: re-run this script after any "Generuj grafik" to restore the pending swap.
`)
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
