import { Inject, Injectable, Logger } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

type TenantClientLike = {
  organizationalUnit: { create(args: { data: { name: string; parentId: null } }): Promise<unknown> }
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
      await client.organizationalUnit.create({
        data: { name: 'Cała firma', parentId: null },
      })
    } finally {
      await client.$disconnect()
    }

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.KEYCLOAK_SETUP },
    })
  }
}
