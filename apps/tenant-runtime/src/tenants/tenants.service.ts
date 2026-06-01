import { ConflictException, Injectable } from '@nestjs/common'
import { ProvisioningStep, TenantStatus } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import type { SignupDto } from './dto/signup.dto.js'

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  async isSlugAvailable(slug: string): Promise<boolean> {
    const existing = await this.prisma.tenant.findFirst({ where: { slug } })
    return existing === null
  }

  async signup(dto: SignupDto): Promise<{ jobId: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            slug: dto.slug,
            name: dto.companyName,
            status: TenantStatus.PENDING,
            metadata: { adminEmail: dto.adminEmail },
          },
        })

        const job = await tx.provisioningJob.create({
          data: {
            tenantId: tenant.id,
            step: ProvisioningStep.CREATE_DB,
            attemptCount: 0,
          },
        })

        await tx.outboxEvent.create({
          data: {
            exchange: 'tenant.provision',
            routingKey: 'tenant.provision',
            payload: { jobId: job.id, tenantId: tenant.id },
          },
        })

        return { jobId: job.id }
      })
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException({ field: 'slug', message: 'Ta nazwa jest już zajęta' })
      }
      throw err
    }
  }
}
