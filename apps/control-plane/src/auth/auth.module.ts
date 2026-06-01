import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { AuthService } from './auth.service.js'
import { AuthController } from './auth.controller.js'
import { GlobalAdminStrategy } from './global-admin.strategy.js'
import { GlobalAdminGuard } from './global-admin.guard.js'

@Module({
  imports: [PassportModule],
  providers: [AuthService, GlobalAdminStrategy, GlobalAdminGuard],
  controllers: [AuthController],
  exports: [GlobalAdminGuard],
})
export class AuthModule {}
