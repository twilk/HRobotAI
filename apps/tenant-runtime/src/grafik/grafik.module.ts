import { Module } from '@nestjs/common'
import { GrafikController } from './grafik.controller.js'
import { GrafikService } from './grafik.service.js'

@Module({
  controllers: [GrafikController],
  providers: [GrafikService],
})
export class GrafikModule {}
