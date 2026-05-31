import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ExecRunner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<unknown>

const defaultExec: ExecRunner = (command, args, options) =>
  execFileAsync(command, args as string[], options)

// Forward ONLY what the prisma CLI + query engine need. Never spread the whole process.env
// into the per-tenant migration subprocess: it holds TENANT_DB_ENCRYPTION_KEY, other tenants'
// connection strings, and unrelated secrets — none of which belong in that child (RODO
// defense-in-depth). PATH + OS basics keep the prisma binary and its native engine working
// cross-platform.
const ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
  'LC_ALL',
] as const

function minimalEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { DATABASE_URL: databaseUrl }
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

/**
 * Runs `prisma migrate deploy` against a single tenant database. The decrypted tenant URL is
 * passed via the DATABASE_URL env var (the tenant schema's datasource reads env("DATABASE_URL")).
 * `exec` is injected for testability. Failures are wrapped with the command + schema path for
 * context (the raw execFile error is attached as `cause`).
 */
export async function migrateTenant(
  decryptedDbUrl: string,
  tenantSchemaPath: string,
  exec: ExecRunner = defaultExec,
): Promise<void> {
  try {
    await exec('prisma', ['migrate', 'deploy', `--schema=${tenantSchemaPath}`], {
      env: minimalEnv(decryptedDbUrl),
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(
      `migrateTenant: "prisma migrate deploy --schema=${tenantSchemaPath}" failed: ${message}`,
      { cause },
    )
  }
}
