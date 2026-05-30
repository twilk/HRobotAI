import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { parseEnv } from '@hrobot/config'

interface JwtPayload {
  sub: string
  email: string
  role: string
}

@Injectable()
export class GlobalAdminStrategy extends PassportStrategy(Strategy, 'global-admin-jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: parseEnv().GLOBAL_ADMIN_JWT_SECRET,
    })
  }

  validate(payload: JwtPayload): JwtPayload {
    if (payload.role !== 'GLOBAL_ADMIN') throw new UnauthorizedException()
    return payload
  }
}
