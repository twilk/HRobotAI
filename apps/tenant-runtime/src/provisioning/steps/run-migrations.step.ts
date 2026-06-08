import { Inject, Injectable, Logger } from '@nestjs/common'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

type SpawnFn = typeof spawnSync

@Injectable()
export class RunMigrationsStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(RunMigrationsStep.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
    @Inject('SPAWN_SYNC') private readonly spawn: SpawnFn,
  ) {}

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    const dbUrl = this.encryption.decrypt(tenant.dbUrl!)
    this.logger.log({ tenantId: job.tenantId }, 'Running tenant migrations')

    const result: SpawnSyncReturns<Buffer> = this.spawn(
      'pnpm',
      ['prisma', 'migrate', 'deploy', '--schema=packages/db/prisma/tenant/schema.prisma'],
      {
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
        encoding: 'buffer',
      },
    )

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? 'unknown error'
      throw new Error(stderr)
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.SEED },
    })
  }
}
