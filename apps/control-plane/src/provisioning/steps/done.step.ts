import { Injectable, Logger } from '@nestjs/common'
import { ProvisioningStep, TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

@Injectable()
export class DoneStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(DoneStep.name)

  constructor(private readonly prisma: ControlPlanePrismaService) {}

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: job.tenantId } })

    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: {
        status: TenantStatus.ACTIVE,
        // G-1: keep the FIRST provisioning timestamp. A redelivered message re-runs this step
        // (its own step stays DONE, so it is the one step that is legitimately re-entered), and
        // overwriting provisionedAt would silently move the tenant's activation date forward —
        // it feeds billing/trial windows and the audit trail.
        ...(tenant.provisionedAt ? {} : { provisionedAt: new Date() }),
      },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.DONE },
    })

    this.logger.log({ tenantId: job.tenantId }, 'Tenant provisioned and ACTIVE')
  }
}
