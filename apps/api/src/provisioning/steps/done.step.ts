import { Injectable, Logger } from '@nestjs/common'
import { TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

@Injectable()
export class DoneStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(DoneStep.name)

  constructor(private readonly prisma: ControlPlanePrismaService) {}

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: { status: TenantStatus.ACTIVE, provisionedAt: new Date() },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: 'DONE' },
    })

    this.logger.log({ tenantId: job.tenantId }, 'Tenant provisioned and ACTIVE')
  }
}
