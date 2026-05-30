import { Injectable } from '@nestjs/common'
import type { ProvisioningStepHandler } from '../provisioning.service.js'

@Injectable()
export class KeycloakSetupStep implements ProvisioningStepHandler {
  async execute(_job: { id: string; tenantId: string; step: string; attemptCount: number }): Promise<void> {
    throw new Error('KeycloakSetupStep not yet implemented')
  }
}
