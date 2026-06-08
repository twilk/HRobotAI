import { Injectable } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import type { TenantConnectionResolver } from '@hrobot/db'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'

@Injectable()
export class TenantConnectionResolverService implements TenantConnectionResolver {
  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async resolveDbUrl(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { dbUrl: true },
    })
    if (!tenant.dbUrl) throw new Error(`Tenant ${tenantId} has no db_url — not yet provisioned`)
    return this.encryption.decrypt(tenant.dbUrl)
  }
}
