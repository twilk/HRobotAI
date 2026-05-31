import { Body, Controller, HttpCode, HttpStatus, Patch } from '@nestjs/common'
import { IsBoolean, IsOptional } from 'class-validator'
import { Role } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { TenantRoute } from '../tenant-runtime/tenant-route.decorator.js'
import { CurrentTenantId } from '../tenant-runtime/tenant-context/current-tenant-client.decorator.js'

export class OnboardingDto {
  @IsOptional() @IsBoolean() addEmployees?: boolean
  @IsOptional() @IsBoolean() configureSchedule?: boolean
  @IsOptional() @IsBoolean() inviteUsers?: boolean
}

@Controller('tenants/me')
@TenantRoute(Role.ADMIN_KLIENTA)
export class OnboardingController {
  constructor(private readonly prisma: ControlPlanePrismaService) {}

  @Patch('onboarding-checklist')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentTenantId() tenantId: string,
    @Body() dto: OnboardingDto,
  ): Promise<Record<string, boolean>> {
    const { onboardingChecklist } = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { onboardingChecklist: true },
    })

    const merged = {
      ...(onboardingChecklist as Record<string, boolean>),
      ...(dto as Record<string, boolean | undefined>),
    }
    // Remove undefined values that may come from optional DTO fields
    Object.keys(merged).forEach((k) => merged[k] === undefined && delete merged[k])

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { onboardingChecklist: merged },
      select: { onboardingChecklist: true },
    })
    return updated.onboardingChecklist as Record<string, boolean>
  }
}
