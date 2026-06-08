import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { TenantsService } from './tenants.service.js'
import { SignupDto } from './dto/signup.dto.js'

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** 10 req/min/IP — prevents slug enumeration */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('slugs/check/:slug')
  async checkSlug(@Param('slug') slug: string): Promise<{ available: boolean }> {
    return { available: await this.tenants.isSlugAvailable(slug) }
  }

  @Post('auth/signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: SignupDto): Promise<{ jobId: string }> {
    return this.tenants.signup(dto)
  }
}
