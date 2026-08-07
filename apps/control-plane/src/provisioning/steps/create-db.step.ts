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

    // W4: CREATE/ALTER ROLE (this.pg, the superuser cluster connection) and persisting dbUrl
    // (this.prisma, the control-plane row) are two independent systems that can never be one
    // atomic transaction — CREATE DATABASE cannot even run inside a transaction block. Two
    // concurrent runs of this step for the SAME tenant are reachable whenever a slow-but-alive
    // consumer's claim lease expires and another consumer legitimately takes over (see W2's
    // fenced release — that fix stops a stale consumer from CORRUPTING the claim, but a lease
    // timeout intentionally still allows a second, legitimate consumer to start work while the
    // first is still running). Without serialization here, two such runs can interleave their
    // password rotations: whichever run's `tenant.update(dbUrl)` happens to land last does not
    // have to be the same run whose ALTER/CREATE ROLE happened last — the tenant is then locked
    // out of its own database with a recorded password that was never the active one.
    //
    // A session-scoped Postgres advisory lock, held on the SAME connection used for the DDL
    // below, is the standard primitive for exactly this: cross-process mutual exclusion around a
    // critical section that cannot be expressed as a single transaction. It is scoped to THIS
    // tenant only (hashtext(tenant.id)), so unrelated tenants never serialize against each other.
    // Held for the WHOLE rotation, including the dbUrl write, so no concurrent run can start its
    // own rotation until this run's password and its recorded dbUrl are back in lock-step.
    const lockKey = ['create-db-step', tenant.id]
    await this.pg.query('SELECT pg_advisory_lock(hashtext($1), hashtext($2))', lockKey)
    try {
      // dbUser is hex-only and dbPassword is base64url (no quotes) → the interpolated DDL is
      // injection-safe; CREATE ROLE / CREATE DATABASE are utility statements that cannot take
      // bind parameters.
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

      // W4: persist dbUrl only AFTER the role's password is confirmed live, and still inside the
      // lock, so the value on record always matches a password THIS run actually set, and no
      // concurrent run can rotate the password again before this run's matching dbUrl is written.
      await this.prisma.tenant.update({
        where: { id: job.tenantId },
        data: { dbUrl: this.encryption.encrypt(dbUrl) },
      })
    } finally {
      await this.pg.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', lockKey)
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.RUN_MIGRATIONS },
    })
  }
}
