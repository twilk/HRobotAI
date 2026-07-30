import { Module } from '@nestjs/common'
import { GrafikController } from './grafik.controller.js'
import { GrafikService } from './grafik.service.js'
import { OPTIMIZER_CLIENT, HttpOptimizerClient } from './optimizer.client.js'

@Module({
  controllers: [GrafikController],
  providers: [GrafikService, { provide: OPTIMIZER_CLIENT, useClass: HttpOptimizerClient }],
  // Exported so `agent-glosowy` (Agent Głosowy) can reuse the SAME schedule-read service (K3),
  // scoped to the caller in GrafikService.listShifts.
  exports: [GrafikService],
})
export class GrafikModule {}
