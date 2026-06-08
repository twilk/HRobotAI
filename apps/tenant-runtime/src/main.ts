import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { Transport, type MicroserviceOptions } from '@nestjs/microservices'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'
import { parseEnv } from '@hrobot/config'

async function bootstrap(): Promise<void> {
  const env = parseEnv()

  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.setGlobalPrefix('api')

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [env.RABBITMQ_URL],
      queue: 'tenant.provision',
      queueOptions: { durable: true },
      noAck: false,
    },
  })

  await app.startAllMicroservices()
  const port = Number(process.env['PORT'] ?? 3000)
  await app.listen(port)
}

void bootstrap()
