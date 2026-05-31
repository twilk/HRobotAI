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

  /**
   * 5 req/min/IP (M7) — signup is unauthenticated AND expensive: each call
   * provisions a Postgres database, runs migrations, and creates a Keycloak
   * realm. The global 100/min default is abuse-grade for this endpoint, so
   * override it with a strict limit. Legit users sign up once; 5/min leaves
   * headroom for a fat-fingered retry without enabling mass tenant creation.
   */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('auth/signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: SignupDto): Promise<{ jobId: string }> {
    return this.tenants.signup(dto)
  }
}
