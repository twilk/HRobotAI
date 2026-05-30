import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { parseEnv } from '@hrobot/config'
import { ProvisioningStep } from '@hrobot/shared'
import { ControlPlanePrismaService } from '../../common/prisma/control-plane-prisma.service.js'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

type FetchFn = typeof fetch

@Injectable()
export class KeycloakSetupStep implements ProvisioningStepHandler {
  private readonly logger = new Logger(KeycloakSetupStep.name)
  private readonly keycloakUrl: string
  private readonly adminPassword: string

  constructor(
    private readonly prisma: ControlPlanePrismaService,
    @Inject('FETCH') private readonly fetchFn: FetchFn,
  ) {
    const env = parseEnv()
    this.keycloakUrl = env.KEYCLOAK_URL
    this.adminPassword = env.KEYCLOAK_ADMIN_CLIENT_SECRET
  }

  private async getAdminToken(): Promise<string> {
    const resp = await this.fetchFn(
      `${this.keycloakUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: 'admin',
          password: this.adminPassword,
        }).toString(),
      },
    )
    const data = await resp.json() as { access_token: string }
    return data.access_token
  }

  async execute(job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: job.tenantId },
    })
    const meta = tenant.metadata as Record<string, unknown>
    const adminEmail = String(meta['adminEmail'] ?? '')
    const realmName = `hrobot-${tenant.slug}`
    const adminBase = `${this.keycloakUrl}/admin/realms`
    const token = await this.getAdminToken()

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    // 1. Create realm
    await this.fetchFn(`${adminBase}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        realm: realmName,
        enabled: true,
        accessTokenLifespan: 300,
        ssoSessionMaxLifespan: 36000,
      }),
    })

    // 2. Create hrobot-web client
    await this.fetchFn(`${adminBase}/${realmName}/clients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientId: 'hrobot-web',
        redirectUris: [`https://${tenant.slug}.hrobot.ai/*`],
        webOrigins: [`https://${tenant.slug}.hrobot.ai`],
        publicClient: true,
      }),
    })

    // 3. Create initial ADMIN_KLIENTA user with temporary password
    const tempPassword = randomBytes(12).toString('base64url')
    const createUserResp = await this.fetchFn(`${adminBase}/${realmName}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: adminEmail,
        email: adminEmail,
        enabled: true,
        credentials: [{ type: 'password', value: tempPassword, temporary: true }],
      }),
    })
    const locationHeader = (createUserResp.headers as { get(name: string): string | null }).get('Location') ?? ''
    const userId = locationHeader.split('/').pop() ?? ''

    // 4. Send credential-reset email so admin sets their own password
    await this.fetchFn(`${adminBase}/${realmName}/users/${userId}/execute-actions-email`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(['UPDATE_PASSWORD']),
    })

    this.logger.log({ tenantId: job.tenantId, realmName }, 'Keycloak realm provisioned')

    await this.prisma.tenant.update({
      where: { id: job.tenantId },
      data: { metadata: { ...meta, realmName, keycloakClientId: 'hrobot-web' } },
    })

    await this.prisma.provisioningJob.update({
      where: { id: job.id },
      data: { step: ProvisioningStep.DONE },
    })
  }
}
