// LIVE demo launcher — `next dev -p 5601` wired to the running `hrobot` compose stack.
// Forces the correct KEYCLOAK_* + TENANT_RUNTIME_URL so the self-authenticating proxy
// mints an `hrobot-web` token (which carries the hrobot_roles mapper). This overrides any
// inherited shell env (e.g. a stray KEYCLOAK_CLIENT_ID=admin-cli, which authenticates but
// lacks the role claim -> tenant-runtime 403). Next.js does NOT let .env.local override real
// env vars, so we set them explicitly here. LOCAL DEMO ONLY.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const nextBin = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '5601'], {
  cwd: dir,
  stdio: 'inherit',
  env: {
    ...process.env,
    TENANT_RUNTIME_URL: 'http://localhost:3001/api',
    KEYCLOAK_TOKEN_URL: 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token',
    KEYCLOAK_CLIENT_ID: 'hrobot-web',
    KEYCLOAK_USERNAME: 'demo',
    KEYCLOAK_PASSWORD: 'demo-staging-2026',
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
