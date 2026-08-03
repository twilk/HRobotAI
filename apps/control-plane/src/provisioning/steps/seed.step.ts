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
      // G-1: the seed must CONVERGE, not accumulate. This used to be an unconditional create(),
      // so a redelivered `tenant.provision` message (RabbitMQ is at-least-once) gave the tenant a
      // SECOND "Cała firma" root and therefore two disjoint org trees — units, employees and RBAC
      // scopes silently split between them. There is no unique constraint to lean on (unit names
      // are free-form and a tenant may legitimately rename or add roots later), so the guard is
      // "a root already exists" — which is exactly what a fresh, unseeded tenant lacks.
      // ProvisioningService's step claim prevents the CONCURRENT case; this guard covers the
      // sequential one (re-run after a lease expiry or a consumer crash).
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
      await client.$disconnect()
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.KEYCLOAK_SETUP },
    })
  }
}
