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

/** Mint a token for `username`/`password` in the demo realm and decode its `sub`. Keycloak
 *  reassigns user ids on every realm rebuild, so any M2-seed User row created by SQL (which only
 *  knows a placeholder keycloak_sub) must be re-pointed to the live id post-seed. Used for both
 *  the admin (`demo`) and pracownica.demo — any tenant-DB User row created by
 *  seed-demo-m2-modules.sql rather than the generic expectSub reconciliation in
 *  seed-keycloak-demo.mjs (that reconciliation runs before this SQL seed, so it can't see rows
 *  that don't exist yet). */
async function resolveSub(username, password) {
  try {
    const res = await fetch(`${KC}/realms/hrobot-staging/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'hrobot-web',
        username,
        password,
      }),
    })
    if (!res.ok) return null
    const { access_token } = await res.json()
    const payload = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
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

  step('applying M2 module schema + demo data (Wnioski/Ustawienia/Dostępy/Użytkownicy/Koszty)')
  const ROLE = process.env.TENANT_ROLE || DB.replace(/^hrobot_t_/, 'hu_')
  // 1) idempotent schema patch (no-op on a fresh, already-migrated tenant)
  psql(readFileSync(join(root, 'scripts', 'apply-m2-tenant-schema.sql'), 'utf8'))
  // 2) ownership → tenant app role (objects created here are owned by postgres; idempotent no-op
  //    when they're already owned by the role, e.g. after a real `prisma migrate deploy`)
  psql(
    ['company_settings', 'access_grant', 'position_cost_rates']
      .map((t) => `ALTER TABLE ${t} OWNER TO ${ROLE};`)
      .join('\n') + `\nALTER TYPE "AccessType" OWNER TO ${ROLE};\nALTER TYPE "AccessStatus" OWNER TO ${ROLE};`,
  )
  // 3) synthetic demo data (idempotent; preserves the APPROVED-leave AI-Grafik anchors)
  psql(readFileSync(join(root, 'scripts', 'seed-demo-m2-modules.sql'), 'utf8'))
  // 4) the seed adds a User row for `demo` (so it can be a leave decider / grant issuer); re-point
  //    its keycloak_sub to the realm's live admin id (same sync class as the users above)
  const adminSub = await resolveSub('demo', 'demo-staging-2026')
  if (adminSub) {
    psql(`UPDATE users SET keycloak_sub='${adminSub}' WHERE email='admin@staging.hrobot.local';`)
  } else {
    console.log('  ⚠ could not resolve admin keycloak_sub (Keycloak down?); admin may not act as a decider')
  }
  // 5) same for pracownica.demo (Katarzyna Zając, cross-unit travel demo candidate, 2026-07-14
  //    spec §7/§12): her User row is also created by the SQL seed above with a placeholder
  //    keycloak_sub, so re-point it to the live Keycloak id or her AUTO_ASK_CONSENT login/consent
  //    step won't resolve `Employee.user.keycloakSub === jwt.sub`.
  const pracownicaSub = await resolveSub('pracownica.demo', 'Pracownica!2026')
  if (pracownicaSub) {
    psql(`UPDATE users SET keycloak_sub='${pracownicaSub}' WHERE email='pracownica.demo@demo.hrobot.local';`)
  } else {
    console.log('  ⚠ could not resolve pracownica.demo keycloak_sub (Keycloak down?); she may not be able to log in / consent')
  }

  console.log(`
✅ Demo backend ready (Grafik + AI + M2 modules).

   Logins (${'http://localhost:5601'} → /login):
     demo            / demo-staging-2026   ADMIN      full grafik + swap approval + all M2 modules
     manager.demo    / Manager!2026        MANAGER    unit-scoped grafik/swaps + wnioski/dostępy (own units)
     pracownik.demo  / Pracownik!2026      PRACOWNIK  read-only "my schedule" + own wnioski (Anna Kowalska)
     pracownica.demo / Pracownica!2026     PRACOWNIK  cross-unit travel demo candidate (Katarzyna Zając, Region Północ)

   M2 modules now populated: Wnioski (6 pending / 26 approved / 1 rejected), Dostępy (15 grants),
   Ustawienia (4Mobility), Użytkownicy (3 kont), Koszty (10 stawek → pełne pokrycie).

   Last step (separate host process by design):
     cd docs/design/web-kit && node start-prod.mjs     # http://localhost:5601 (demo build)

   Demo week: 13–19 July 2026.
   Grafik/AI script:  data/m2-evidence/demo-scenario-4mobility.md
   M2 modules script: docs/demo/M2-demo-walkthrough.md
   NB: re-run this script after any "Generuj grafik" to restore the pending swap. Idempotent.
`)
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
