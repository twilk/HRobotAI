import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from './roles.decorator.js'

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!required?.length) return true

    const roles: string[] = (ctx.switchToHttp().getRequest<{ user: { hrobot_roles?: string[] } }>().user?.hrobot_roles) ?? []
    if (!required.some((r) => roles.includes(r))) {
      throw new ForbiddenException(`Required roles: [${required.join(', ')}]`)
    }
    return true
  }
}
