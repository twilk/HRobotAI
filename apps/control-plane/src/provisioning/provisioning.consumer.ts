import { Controller } from '@nestjs/common'
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices'
import { ProvisioningService } from './provisioning.service.js'

@Controller()
export class ProvisioningConsumer {
  constructor(private readonly provisioning: ProvisioningService) {}

  // The outbox relay publishes with ClientProxy.emit() — an EVENT — so the handler must be
  // @EventPattern, not @MessagePattern (which is for send()/RPC). With @MessagePattern the
  // emitted message has no matching handler and NestJS nacks it ("unsupported event"), so the
  // job never leaves CREATE_DB. Manual ack is kept (noAck:false) for at-least-once delivery.
  @EventPattern('tenant.provision')
  async handle(
    @Payload() msg: { jobId: string; tenantId: string },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    await this.provisioning.process(msg)
    const channel = context.getChannelRef() as { ack(msg: object): void }
    channel.ack(context.getMessage() as object)
  }
}
