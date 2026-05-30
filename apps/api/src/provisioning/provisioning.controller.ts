import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Controller('provision')
export class ProvisioningController {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  @Get('status/:jobId')
  async status(@Param('jobId') jobId: string): Promise<{
    step: string
    attemptCount: number
    error: string | null
  }> {
    const job = await this.prisma.provisioningJob.findUnique({ where: { id: jobId } })
    if (!job) throw new NotFoundException('Provisioning job not found')
    return { step: job.step, attemptCount: job.attemptCount, error: job.lastError }
  }
}
