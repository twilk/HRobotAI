// Poll every staging service until healthy, or fail the deploy with a clear per-service report.
//
// Runs on the RUNNER HOST (not in a container): it checks the ports compose publishes to localhost
// plus the runner-side web front. Zero dependencies — Node built-ins only, so it runs the same under
// Git Bash on the Windows dev box as on Linux.
//
//   node infra/deploy/health-check.mjs
//
// Overridable via env: CP_URL, TR_URL, WEB_URL, KEYCLOAK_URL, PG_HOST/PG_PORT, REDIS_HOST/REDIS_PORT,
// HEALTH_TIMEOUT_MS, HEALTH_INTERVAL_MS.

import net from 'node:net'
import { execFile } from 'node:child_process'

const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 180_000)
const INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS ?? 3_000)

const CP_URL = process.env.CP_URL ?? 'http://localhost:3000'
const TR_URL = process.env.TR_URL ?? 'http://localhost:3001'
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173'
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function httpOk(url, accept = (s) => s >= 200 && s < 400) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' })
    if (!accept(res.status)) throw new Error(`HTTP ${res.status}`)
    return true
  } finally {
    clearTimeout(t)
  }
}

function tcpOpen(host, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }, () => {
      sock.destroy()
      resolve(true)
    })
    sock.setTimeout(4_000)
    sock.on('timeout', () => {
      sock.destroy()
      reject(new Error('tcp timeout'))
    })
    sock.on('error', reject)
  })
}

// Backing services (postgres/redis) are probed INSIDE their containers via `docker compose exec`:
// on a shared box their ports are deliberately unpublished (see docker-compose.override.yml), so a
// host TCP probe either refuses or — worse — hits a DIFFERENT project's database on the default
// port and reports a false positive. Host-port TCP probing remains available via PG_HOST/REDIS_HOST.
function composeExecOk(service, cmd) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['compose', 'exec', '-T', service, ...cmd], { timeout: 8_000 }, (err) =>
      err ? reject(new Error(`${service} probe failed: ${err.message.split('\n')[0]}`)) : resolve(true))
  })
}

// Each check throws on failure; the poller retries until it passes or the deadline hits.
const CHECKS = [
  { name: 'postgres', run: () => process.env.PG_HOST
      ? tcpOpen(process.env.PG_HOST, Number(process.env.PG_PORT ?? 5432))
      : composeExecOk('postgres', ['pg_isready', '-U', 'postgres']) },
  { name: 'redis', run: () => process.env.REDIS_HOST
      ? tcpOpen(process.env.REDIS_HOST, Number(process.env.REDIS_PORT ?? 6379))
      : composeExecOk('redis', ['redis-cli', 'ping']) },
  { name: 'keycloak', run: () => httpOk(`${KEYCLOAK_URL}/realms/master`) },
  { name: 'control-plane', run: () => httpOk(`${CP_URL}/api/health/ready`) },
  { name: 'tenant-runtime', run: () => httpOk(`${TR_URL}/api/health/ready`) },
  { name: 'web', run: () => httpOk(WEB_URL) },
]

async function main() {
  const deadline = Date.now() + TIMEOUT_MS
  const pending = new Map(CHECKS.map((c) => [c.name, c]))
  const lastError = new Map()

  console.log(`Health-checking ${CHECKS.length} services (timeout ${Math.round(TIMEOUT_MS / 1000)}s)...`)
  while (pending.size > 0 && Date.now() < deadline) {
    for (const [name, check] of [...pending]) {
      try {
        await check.run()
        console.log(`  ok ${name}`)
        pending.delete(name)
      } catch (err) {
        lastError.set(name, err instanceof Error ? err.message : String(err))
      }
    }
    if (pending.size > 0) await sleep(INTERVAL_MS)
  }

  if (pending.size > 0) {
    console.error(`\nDEPLOY HEALTH-CHECK FAILED — ${pending.size} service(s) not healthy:`)
    for (const name of pending.keys()) {
      console.error(`  x ${name}: ${lastError.get(name) ?? 'no successful probe'}`)
    }
    console.error('\nInspect with: docker compose --profile full ps  &&  docker compose --profile full logs --tail=100')
    process.exit(1)
  }
  console.log('\nAll staging services healthy.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
