// Ensure the canonical staging tenant exists (create via the real signup/provisioning path if
// absent) and is ACTIVE with a provisioned tenant DB. Idempotent — a fast no-op on redeploy.
//
// Runs INSIDE the control-plane container (see _staging-lib.mjs header). The seed step
// (seed-staging.mjs) re-resolves the tenant independently, so nothing needs to be handed back to the
// workflow here; we just guarantee a seedable tenant exists before the seed runs.
//
//   docker compose exec -T --workdir /app control-plane node infra/deploy/ensure-staging-tenant.mjs

import { ensureStagingTenant, loadWorkspace } from './_staging-lib.mjs'

async function main() {
  const { ControlPlaneClient } = await loadWorkspace()
  const control = new ControlPlaneClient()
  try {
    const { id } = await ensureStagingTenant(control)
    console.log(`tenant_id=${id}`)
  } finally {
    await control.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
