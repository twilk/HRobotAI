import { Injectable, UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import * as jwt from 'jsonwebtoken'
import { parseEnv } from '@hrobot/config'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

@Injectable()
export class AuthService {
  private readonly jwtSecret = parseEnv().GLOBAL_ADMIN_JWT_SECRET

  constructor(private readonly prisma: ControlPlanePrismaService) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const admin = await this.prisma.globalAdmin.findUnique({ where: { email } })
    if (!admin) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(password, admin.passwordHash)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    const accessToken = jwt.sign(
      { sub: admin.id, email: admin.email, role: 'GLOBAL_ADMIN' },
      this.jwtSecret,
      { expiresIn: '8h' },
    )
    return { accessToken }
  }
}
