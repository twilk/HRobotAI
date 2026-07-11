// Shared helpers for the staging deploy's tenant-provisioning + seed steps.
//
// RUNS INSIDE the control-plane container (see .github/workflows/deploy-staging.yml). That is
// deliberate: the tenant DB URLs stored in the control plane are encrypted with the compose-internal
// host (`postgres`), and the encryption key + CONTROL_PLANE_DATABASE_URL only line up inside the
// compose network. Running here means no host-rewriting hacks and prod-parity connectivity.
//
// The @hrobot/* packages are imported by RELATIVE path to their built `dist/` (not by bare specifier):
// pnpm links each workspace package's own deps into its own node_modules, so `@hrobot/db` is not
// resolvable from an infra/ file, but `packages/db/dist/index.js` resolves its OWN transitive deps
// fine. `dist/` is rebuilt inside the image by `pnpm run build`, so it is always present at runtime.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '../..')

// Lazily import the built workspace clients by absolute path (see header note).
export async function loadWorkspace() {
  const [{ ControlPlaneClient }, { EncryptionService }] = await Promise.all([
    import(new URL('../../packages/db/dist/index.js', import.meta.url)),
    import(new URL('../../packages/shared/dist/index.js', import.meta.url)),
  ])
  return { ControlPlaneClient, EncryptionService }
}

export const config = {
  slug: process.env.STAGING_TENANT_SLUG ?? 'staging',
  companyName: process.env.STAGING_COMPANY_NAME ?? 'HRobot Staging',
  adminEmail: process.env.STAGING_ADMIN_EMAIL ?? 'admin@staging.hrobot.local',
  // control-plane HTTP, reached from inside its own container.
  controlPlaneOrigin: process.env.CONTROL_PLANE_ORIGIN ?? 'http://localhost:3000',
  // How long to wait for async provisioning (CREATE_DB → migrate → keycloak → seed → DONE).
  provisionTimeoutMs: Number(process.env.STAGING_PROVISION_TIMEOUT_MS ?? 300_000),
  pollIntervalMs: Number(process.env.STAGING_POLL_INTERVAL_MS ?? 3_000),
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function requireEncryptionKey() {
  const key = process.env.TENANT_DB_ENCRYPTION_KEY
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'TENANT_DB_ENCRYPTION_KEY is required and must be 64 hex chars (32 bytes). ' +
        'It comes from the runner .env (loaded into this container by compose env_file); ' +
        'see docs/infra/staging-runner.md.',
    )
  }
  return key
}

async function findTenant(control, slug) {
  return control.tenant.findFirst({
    where: { slug },
    select: { id: true, slug: true, status: true, dbUrl: true },
  })
}

async function signup(origin, body) {
  const res = await fetch(`${origin}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (res.status !== 202 && res.status !== 200) {
    throw new Error(`signup failed: HTTP ${res.status} — ${text}`)
  }
  return JSON.parse(text)
}

/**
 * Ensure the canonical staging tenant exists and is ACTIVE with a provisioned DB.
 * Idempotent: on redeploy the tenant already exists, so this is a fast no-op poll.
 * Returns { id } — the real tenant UUID (needed as the seed's PII-AAD tenantId).
 */
export async function ensureStagingTenant(control) {
  const { slug, companyName, adminEmail, controlPlaneOrigin } = config

  let tenant = await findTenant(control, slug)
  if (tenant && tenant.status === 'ACTIVE' && tenant.dbUrl) {
    console.log(`Staging tenant already provisioned: ${tenant.id} (slug=${slug})`)
    return { id: tenant.id }
  }

  if (!tenant) {
    console.log(`No staging tenant found — signing up slug="${slug}"...`)
    const { jobId } = await signup(controlPlaneOrigin, { slug, companyName, adminEmail })
    console.log(`Provisioning job started: ${jobId}`)
  } else {
    console.log(`Staging tenant exists but not ready (status=${tenant.status}) — waiting for provisioning...`)
  }

  const deadline = Date.now() + config.provisionTimeoutMs
  let lastStatus = tenant?.status ?? 'PENDING'
  while (Date.now() < deadline) {
    await sleep(config.pollIntervalMs)
    tenant = await findTenant(control, slug)
    if (!tenant) continue
    if (tenant.status !== lastStatus) {
      console.log(`  tenant status: ${lastStatus} → ${tenant.status}`)
      lastStatus = tenant.status
    }
    if (tenant.status === 'ACTIVE' && tenant.dbUrl) {
      console.log(`Staging tenant provisioned: ${tenant.id}`)
      return { id: tenant.id }
    }
    if (tenant.status === 'SUSPENDED' || tenant.status === 'DEPROVISIONED') {
      throw new Error(`Provisioning ended in terminal status ${tenant.status} — check control-plane logs.`)
    }
  }
  throw new Error(
    `Timed out after ${config.provisionTimeoutMs}ms waiting for staging tenant to become ACTIVE ` +
      `(last status: ${lastStatus}). Common cause: KEYCLOAK_SETUP failed — verify the Keycloak admin ` +
      `client + secret (see docs/infra/staging-runner.md).`,
  )
}

/** Decrypt the tenant's DB URL. Host stays compose-internal (`postgres`) — correct in-container. */
export function decryptTenantDbUrl(EncryptionService, encryptedDbUrl) {
  const enc = EncryptionService.fromHexKey(requireEncryptionKey())
  return enc.decrypt(encryptedDbUrl)
}

/** Fetch the ACTIVE staging tenant's { id, dbUrl(encrypted) }, or throw if not ready. */
export async function getActiveStagingTenant(control) {
  const tenant = await findTenant(control, config.slug)
  if (!tenant) throw new Error(`Staging tenant "${config.slug}" does not exist — run ensure-staging-tenant first.`)
  if (tenant.status !== 'ACTIVE' || !tenant.dbUrl) {
    throw new Error(`Staging tenant "${config.slug}" is not ACTIVE with a DB (status=${tenant.status}).`)
  }
  return tenant
}
