import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Controller('provision')
export class ProvisioningController {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  /** 30 req/min/IP — jobId is a secret UUID; still cap polling abuse */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
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
