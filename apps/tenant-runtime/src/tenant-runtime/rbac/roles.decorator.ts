import { SetMetadata } from '@nestjs/common'
import { Role } from '@hrobot/shared'

export const ROLES_KEY = 'hrobot_required_roles'

export const Roles = (...roles: (typeof Role)[keyof typeof Role][]): MethodDecorator =>
  SetMetadata(ROLES_KEY, roles)
