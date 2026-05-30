import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ControlPlaneClient } from '@hrobot/db'

@Injectable()
export class ControlPlanePrismaService
  extends ControlPlaneClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
