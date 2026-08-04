import { Inject, Injectable, Logger } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

type TenantClientLike = {
  organizationalUnit: {
    findFirst(args: { where: { parentId: null } }): Promise<{ id: string } | null>
    create(args: { data: { name: string; parentId: null } }): Promise<unknown>
  }
  // W4: a raw escape hatch for the advisory lock below. Real Prisma clients (what
  // TENANT_CLIENT_FACTORY actually constructs) always have this; it is just absent from the
  // narrow interface above.
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>
  $disconnect(): Promise<void>
}
type TenantClientFactory = (dbUrl: string) => TenantClientLike

@Injectable()
export class SeedStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(SeedStep.name)

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
    @Inject('TENANT_CLIENT_FACTORY') private readonly clientFactory: TenantClientFactory,
  ) {}

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })

    const dbUrl = this.encryption.decrypt(tenant.dbUrl!)
    const client = this.clientFactory(dbUrl)

    try {
      this.logger.log({ tenantId: job.tenantId }, 'Seeding tenant database')
      // W4: this check-then-act ("a root already exists" ⇒ skip) is safe against a SEQUENTIAL
      // re-run (after a lease expiry or a consumer crash), but not against a CONCURRENT one — both
      // runs can read "absent" before either writes. The comment here used to claim
      // "ProvisioningService's step claim prevents the CONCURRENT case"; W2 shows that claim is
      // false in general (a lease timeout lets a second, legitimate consumer start work while the
      // first is still genuinely running, not crashed). There is no unique constraint to lean on
      // at the schema level (unit names are free-form; a tenant may legitimately rename or add
      // roots later — see the note in the triage), so close the window with a Postgres advisory
      // lock instead: scoped to THIS tenant's own database (every tenant gets its own physical
      // Postgres database, so the lock namespace is already isolated per-tenant with no extra
      // key needed), held for the whole check-then-act, so a second concurrent run blocks until
      // the first has committed (or skipped) its root — never races it.
      await client.$queryRawUnsafe(`SELECT pg_advisory_lock(hashtext('hrobot-seed-root'))`)
      try {
        // G-1: the seed must CONVERGE, not accumulate. This used to be an unconditional create(),
        // so a redelivered `tenant.provision` message (RabbitMQ is at-least-once) gave the tenant
        // a SECOND "Cała firma" root and therefore two disjoint org trees — units, employees and
        // RBAC scopes silently split between them.
        const existingRoot = await client.organizationalUnit.findFirst({ where: { parentId: null } })
        if (existingRoot) {
          this.logger.log(
            { tenantId: job.tenantId, unitId: existingRoot.id },
            'Root organizational unit already present — seed already applied, skipping',
          )
        } else {
          await client.organizationalUnit.create({
            data: { name: 'Cała firma', parentId: null },
          })
        }
      } finally {
        await client.$queryRawUnsafe(`SELECT pg_advisory_unlock(hashtext('hrobot-seed-root'))`)
      }
    } finally {
      await client.$disconnect()
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.KEYCLOAK_SETUP },
    })
  }
}
