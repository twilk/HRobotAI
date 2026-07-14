// PRODUCTION demo launcher — `next build` then `next start -p 5601`, wired to the running `hrobot`
// compose stack. Use THIS for the customer demo (not start-live.mjs / `next dev`): production mode
// has NO dev-tools overlay (the "N Issues" pill never appears) and NO on-demand compile stalls
// (dev recompiles the first hit of each route, which can hang ~30s live). Forces the same
// KEYCLOAK_* + TENANT_RUNTIME_URL env as start-live so the self-auth proxy mints an `hrobot-web`
// token. LOCAL DEMO ONLY.
import { spawnSync, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const nextBin = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next')

const env = {
  ...process.env,
  TENANT_RUNTIME_URL: 'http://localhost:3001/api',
  KEYCLOAK_TOKEN_URL: 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token',
  KEYCLOAK_CLIENT_ID: 'hrobot-web',
  KEYCLOAK_USERNAME: 'demo',
  KEYCLOAK_PASSWORD: 'demo-staging-2026',
  NODE_ENV: 'production',
}

rmSync(join(dir, '.next'), { recursive: true, force: true })
console.log('▶ next build (production, ~30–60s)…')
const build = spawnSync(process.execPath, [nextBin, 'build'], { cwd: dir, stdio: 'inherit', env })
if (build.status !== 0) {
  console.error('\n✗ build failed. If it is a stale-cache "Cannot find module \'./NNN.js\'", delete .next and re-run.')
  process.exit(build.status ?? 1)
}

console.log('\n▶ next start -p 5601 (production — no dev overlay, no compile stalls)')
const child = spawn(process.execPath, [nextBin, 'start', '-p', '5601'], { cwd: dir, stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
