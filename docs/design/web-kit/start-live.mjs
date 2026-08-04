// LIVE demo launcher — `next dev -p 5601` wired to the running `hrobot` compose stack.
// Forces the correct KEYCLOAK_* + TENANT_RUNTIME_URL so the self-authenticating proxy
// mints an `hrobot-web` token (which carries the hrobot_roles mapper). This overrides any
// inherited shell env (e.g. a stray KEYCLOAK_CLIENT_ID=admin-cli, which authenticates but
// lacks the role claim -> tenant-runtime 403). Next.js does NOT let .env.local override real
// env vars, so we set them explicitly here. LOCAL DEMO ONLY.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const nextBin = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next')

// KEYCLOAK_PASSWORD is deliberately NOT set here. It is a credential and must not live in the repo
// (.env.example states the rule; this file used to break it). Supply it via the shell environment or
// via docs/design/web-kit/.env.local, which is gitignored — Next.js loads .env.local for every key
// this launcher does not set explicitly, so leaving it out is exactly what makes that work.
if (!process.env.KEYCLOAK_PASSWORD && !existsSync(join(dir, '.env.local'))) {
  console.error(
    '\n✗ Brak hasła Keycloaka. Ustaw KEYCLOAK_PASSWORD w środowisku albo utwórz' +
      '\n  docs/design/web-kit/.env.local (gitignored) z KEYCLOAK_PASSWORD=...\n',
  )
  process.exit(1)
}

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '5601'], {
  cwd: dir,
  stdio: 'inherit',
  env: {
    ...process.env,
    TENANT_RUNTIME_URL: 'http://localhost:3001/api',
    KEYCLOAK_TOKEN_URL: 'http://localhost:8081/realms/hrobot-staging/protocol/openid-connect/token',
    KEYCLOAK_CLIENT_ID: 'hrobot-web',
    KEYCLOAK_USERNAME: 'demo',
    // Self-minting is an AMBIENT credential (see lib/tenant-runtime.ts ambientServiceTokenAllowed):
    // off by default so no deployment can lend its own token to an anonymous caller. This launcher
    // is LOCAL DEMO ONLY and its whole point is the self-authenticating proxy, so it opts in. The
    // /api gate in middleware.ts still 401s anonymous callers here — the fallback only ever applies
    // to a request that already carried a credential.
    HROBOT_ALLOW_AMBIENT_TOKEN: '1',
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
