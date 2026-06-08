import { Module } from '@nestjs/common'
import { TenantsService } from './tenants.service.js'
import { TenantsController } from './tenants.controller.js'

@Module({
  providers: [TenantsService],
  controllers: [TenantsController],
})
export class TenantsModule {}
