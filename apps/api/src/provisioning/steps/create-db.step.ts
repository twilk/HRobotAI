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
  private readonly dbHost: string
  private readonly dbPort: string

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('SUPERUSER_PG_CLIENT') private readonly pg: PgClient,
    private readonly encryption: EncryptionService,
    @Inject('POSTGRES_HOST') dbHost: string,
    @Inject('POSTGRES_PORT') dbPort: string,
  ) {
    this.dbHost = dbHost
    this.dbPort = dbPort
  }

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    // C2/M1: use the FULL tenant id (hyphens stripped); an 8-char slice collides across tenants.
    const safeId = tenant.id.replace(/-/g, '')
    const dbName = `hrobot_t_${safeId}`
    const dbUser = `hu_${safeId}`
    const dbPassword = randomBytes(24).toString('base64url')
    const dbUrl = `postgresql://${dbUser}:${dbPassword}@${this.dbHost}:${this.dbPort}/${dbName}`

    this.logger.log({ tenantId: tenant.id, dbName }, 'Creating tenant database')

    // C2: persist the encrypted url BEFORE issuing DDL, and keep the role password in lock-step
    // (ALTER on retry) so a regenerated password can never drift from the stored url. dbUser is
    // hex-only and dbPassword is base64url (no quotes) → the interpolated DDL is injection-safe;
    // CREATE ROLE / CREATE DATABASE are utility statements that cannot take bind parameters.
    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: { dbUrl: this.encryption.encrypt(dbUrl) },
    })

    const roleExists =
      (await this.pg.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [dbUser])).rows.length > 0
    if (roleExists) {
      await this.pg.query(`ALTER ROLE "${dbUser}" WITH PASSWORD '${dbPassword}'`)
    } else {
      await this.pg.query(`CREATE ROLE "${dbUser}" LOGIN PASSWORD '${dbPassword}'`)
    }

    const dbExists =
      (await this.pg.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName])).rows.length > 0
    if (!dbExists) {
      await this.pg.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`)
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.RUN_MIGRATIONS },
    })
  }
}
