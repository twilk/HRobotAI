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
    done: boolean
    failed: boolean
    errorCode: string | null
  }> {
    const job = await this.prisma.provisioningJob.findUnique({ where: { id: jobId } })
    if (!job) throw new NotFoundException('Provisioning job not found')
    // Never return raw lastError here: this endpoint is unauthenticated and lastError can
    // contain the tenant DATABASE_URL + password (e.g. prisma migrate stderr). Coarse shape only.
    const failed = job.step === 'FAILED' // matches ProvisioningStep.FAILED
    return {
      step: job.step,
      attemptCount: job.attemptCount,
      done: failed || job.step === 'DONE',
      failed,
      errorCode: failed ? 'PROVISIONING_FAILED' : null,
    }
  }
}
