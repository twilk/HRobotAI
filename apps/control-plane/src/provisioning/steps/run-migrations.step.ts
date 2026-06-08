import { Inject, Injectable, Logger } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

/** Resolve the Prisma CLI's JS entrypoint so we can run it with the current Node binary directly.
 *  Spawning `pnpm prisma …` as a child hangs on Windows (the pnpm shell shim never returns under
 *  execFile); invoking node on the resolved CLI is deterministic and cross-platform. `prisma` is a
 *  dependency of @hrobot/db (not this app), so resolve it via @hrobot/db's own resolution paths.
 *  The app compiles to CommonJS, so `require.resolve` is available. */
function resolvePrismaCli(): string {
  // @hrobot/db is where `prisma` is installed; resolve its entry, then resolve prisma from there.
  const dbEntry = require.resolve('@hrobot/db')
  const pkgJson = require.resolve('prisma/package.json', { paths: [dbEntry] })
  return pkgJson.replace(/package\.json$/, 'build/index.js')
}

// C5: async runner so a long `prisma migrate deploy` never blocks the shared HTTP + AMQP event
// loop (was synchronous spawnSync). Injected for testability; the module provides promisify(execFile).
export type ExecFileAsyncFn = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout?: number },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>

@Injectable()
export class RunMigrationsStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(RunMigrationsStep.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
    @Inject('EXEC_FILE') private readonly exec: ExecFileAsyncFn,
  ) {}

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    const dbUrl = this.encryption.decrypt(tenant.dbUrl!)
    this.logger.log({ tenantId: job.tenantId }, 'Running tenant migrations')

    try {
      await this.exec(
        process.execPath, // the current node binary — avoids the pnpm shell shim (hangs on Windows)
        [resolvePrismaCli(), 'migrate', 'deploy', '--schema=packages/db/prisma/tenant/schema.prisma'],
        { env: { ...process.env, DATABASE_URL: dbUrl }, timeout: 120_000 },
      )
    } catch (err: unknown) {
      // execFile rejects with an Error carrying .stderr on non-zero exit. Sanitize: the decrypted
      // DATABASE_URL (with password) must never surface in the thrown message / lastError.
      const e = err as { stderr?: unknown; message?: unknown }
      const detail = String(e.stderr ?? e.message ?? 'migration failed')
      throw new Error(detail.replace(/postgresql:\/\/[^@\s]*@/gi, 'postgresql://***@'))
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.SEED },
    })
  }
}
