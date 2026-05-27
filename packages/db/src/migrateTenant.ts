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

/**
 * Runs `prisma migrate deploy` against a single tenant database. The decrypted
 * tenant URL is passed via the DATABASE_URL env var (the tenant schema's
 * datasource reads env("DATABASE_URL")). `exec` is injected for testability.
 */
export async function migrateTenant(
  decryptedDbUrl: string,
  tenantSchemaPath: string,
  exec: ExecRunner = defaultExec,
): Promise<void> {
  await exec('prisma', ['migrate', 'deploy', `--schema=${tenantSchemaPath}`], {
    env: { ...process.env, DATABASE_URL: decryptedDbUrl },
  })
}
