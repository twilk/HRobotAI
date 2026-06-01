import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'
import { parseEnv } from '@hrobot/config'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  readonly client: Redis

  constructor() {
    const { REDIS_URL } = parseEnv()
    this.client = new Redis(REDIS_URL)
    this.client.on('error', (err: Error) =>
      this.logger.error({ err }, 'Redis connection error'),
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
