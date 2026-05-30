import { Global, Module } from '@nestjs/common'
import { ControlPlanePrismaService } from './prisma/control-plane-prisma.service.js'
import { RedisService } from './redis/redis.service.js'

@Global()
@Module({
  providers: [ControlPlanePrismaService, RedisService],
  exports: [ControlPlanePrismaService, RedisService],
})
export class CommonModule {}
