// Seed the frozen canonical synthetic dataset into the ACTIVE staging tenant.
//
// Runs INSIDE the control-plane container. Resolves + decrypts the staging tenant DB URL here so the
// password never crosses the runner/workflow boundary, then invokes the canonical seed runner
// (`@hrobot/db` → scripts/seed-synthetic.ts, i.e. the `seed:synthetic` package script) with:
//   - DATABASE_URL          = the decrypted tenant DB URL (host stays compose-internal `postgres`)
//   - argv[2]               = the REAL tenant UUID, bound into the PII ciphertext AAD so the running
//                             apps can later decrypt PESEL/home-address for this tenant.
// The seed is deterministic + idempotent (UUIDv5 upserts), so re-deploys reset the known set safely.
//
//   docker compose --profile full exec -T control-plane node infra/deploy/seed-staging.mjs

import { spawnSync } from 'node:child_process'
import {
  REPO_ROOT,
  decryptTenantDbUrl,
  getActiveStagingTenant,
  loadWorkspace,
  requireEncryptionKey,
} from './_staging-lib.mjs'

async function main() {
  requireEncryptionKey() // fail fast with a clear message before touching the DB
  const { ControlPlaneClient, EncryptionService } = await loadWorkspace()
  const control = new ControlPlaneClient()

  let tenantId
  let databaseUrl
  try {
    const tenant = await getActiveStagingTenant(control)
    tenantId = tenant.id
    databaseUrl = decryptTenantDbUrl(EncryptionService, tenant.dbUrl)
  } finally {
    await control.$disconnect()
  }

  console.log(`Seeding synthetic dataset into staging tenant ${tenantId}...`)
  // Canonical seed entrypoint == `pnpm --filter @hrobot/db seed:synthetic`; the explicit `exec tsx`
  // form guarantees the tenant UUID reaches argv[2] unambiguously.
  const res = spawnSync(
    'pnpm',
    ['--filter', '@hrobot/db', 'exec', 'tsx', 'scripts/seed-synthetic.ts', tenantId],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      // DATABASE_URL is scoped to this child only — never persisted or logged.
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  )
  if (res.status !== 0) {
    process.exitCode = res.status ?? 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
