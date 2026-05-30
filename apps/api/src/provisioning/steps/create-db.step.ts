import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type { Client as PgClient } from 'pg'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

@Injectable()
export class CreateDbStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(CreateDbStep.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('SUPERUSER_PG_CLIENT') private readonly pg: PgClient,
    private readonly encryption: EncryptionService,
  ) {}

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    const shortId = tenant.id.replace(/-/g, '').slice(0, 8)
    const dbName = `hrobot_t_${shortId}`
    const dbUser = `hu_${shortId}`
    const dbPassword = randomBytes(24).toString('base64url')

    this.logger.log({ tenantId: tenant.id, dbName }, 'Creating tenant database')

    await this.pg.query(
      `CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`,
    )
    await this.pg.query(
      `CREATE DATABASE "${dbName}" OWNER "${dbUser}"`,
    )

    // Extract host/port from superuser URL for the tenant connection string
    const superuserUrl = new URL(process.env['POSTGRES_SUPERUSER_URL'] ?? 'postgresql://localhost:5432/postgres')
    const host = superuserUrl.hostname
    const port = superuserUrl.port || '5432'
    const dbUrl = `postgresql://${dbUser}:${dbPassword}@${host}:${port}/${dbName}`
    const encryptedUrl = this.encryption.encrypt(dbUrl)

    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: { dbUrl: encryptedUrl },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.RUN_MIGRATIONS },
    })
  }
}
