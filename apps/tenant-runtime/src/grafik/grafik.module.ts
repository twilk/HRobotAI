import { Module } from '@nestjs/common'
import { GrafikController } from './grafik.controller.js'
import { GrafikService } from './grafik.service.js'
import { OPTIMIZER_CLIENT, HttpOptimizerClient } from './optimizer.client.js'

@Module({
  controllers: [GrafikController],
  providers: [GrafikService, { provide: OPTIMIZER_CLIENT, useClass: HttpOptimizerClient }],
})
export class GrafikModule {}
