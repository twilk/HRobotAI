import { Controller, Get } from '@nestjs/common'
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthCheckError,
  HealthIndicatorResult,
} from '@nestjs/terminus'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import { RedisService } from '../common/redis/redis.service.js'

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: ControlPlanePrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' }
  }

  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.prisma.$queryRaw`SELECT 1`
          return { 'control-plane-db': { status: 'up' } }
        } catch (err) {
          throw new HealthCheckError('DB unavailable', {
            'control-plane-db': { status: 'down', message: String(err) },
          })
        }
      },
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.redis.client.ping()
          return { redis: { status: 'up' } }
        } catch (err) {
          throw new HealthCheckError('Redis unavailable', {
            redis: { status: 'down', message: String(err) },
          })
        }
      },
    ])
  }
}
