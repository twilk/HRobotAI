import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class KeycloakJwtGuard extends AuthGuard('keycloak-jwt') {}
