import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { IsEmail, IsString, MinLength } from 'class-validator'
import { AuthService } from './auth.service.js'

// Without these decorators the global ValidationPipe({ whitelist: true }) strips
// email/password to undefined → bcrypt.compare(undefined, ...) → login can never succeed.
class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(1)
  password!: string
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('global/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ accessToken: string }> {
    return this.auth.login(dto.email, dto.password)
  }
}
