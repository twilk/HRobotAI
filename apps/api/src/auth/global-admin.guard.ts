import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class GlobalAdminGuard extends AuthGuard('global-admin-jwt') {}
