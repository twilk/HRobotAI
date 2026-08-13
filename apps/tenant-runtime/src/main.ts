import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'

// N-1: tenant-runtime deliberately attaches NO RabbitMQ microservice.
//
// It used to bind `tenant.provision` — the same queue as control-plane, from a copy of
// control-plane's provisioning module. RabbitMQ load-balances a queue round-robin across every
// connected consumer, so roughly half of all provisioning steps ran on this copy. That silently
// disabled control-plane's at-least-once step claim (G-1): a duplicate delivery routed here was
// executed unconditionally, and the tenant ended up with two "Cała firma" org roots.
//
// Provisioning is a CONTROL-PLANE concern (it owns provisioning_jobs, the superuser Postgres
// connection that creates tenant databases, and the Keycloak realm bootstrap). tenant-runtime is
// the per-tenant data plane and has no business running it.
//
// Do not re-add a microservice here for `tenant.provision`.
// `apps/control-plane/src/provisioning/competing-consumers.spec.ts` fails if you do.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.setGlobalPrefix('api')

  const port = Number(process.env['PORT'] ?? 3000)
  await app.listen(port)
}

void bootstrap()
