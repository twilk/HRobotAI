import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common'
import { TenantsService } from './tenants.service.js'
import { SignupDto } from './dto/signup.dto.js'

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

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
