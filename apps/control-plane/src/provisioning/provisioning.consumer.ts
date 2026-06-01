import { Controller } from '@nestjs/common'
import { Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices'
import { ProvisioningService } from './provisioning.service.js'

@Controller()
export class ProvisioningConsumer {
  constructor(private readonly provisioning: ProvisioningService) {}

  @MessagePattern('tenant.provision')
  async handle(
    @Payload() msg: { jobId: string; tenantId: string },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    await this.provisioning.process(msg)
    const channel = context.getChannelRef() as { ack(msg: object): void }
    channel.ack(context.getMessage() as object)
  }
}
