import { Injectable, Logger } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import * as jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'

export interface JwtPayload {
  sub: string
  iss: string
  hrobot_roles: string[]
  exp: number
  [key: string]: unknown
}

type JwtDoneCallback = (err: Error | null, key?: string) => void

@Injectable()
export class KeycloakJwtStrategy extends PassportStrategy(Strategy, 'keycloak-jwt') {
  private readonly logger = new Logger(KeycloakJwtStrategy.name)

  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: async (
        _req: unknown,
        rawToken: string,
        done: JwtDoneCallback,
      ): Promise<void> => {
        try {
          const decoded = jwt.decode(rawToken, { complete: true })
          const payload = decoded?.payload as JwtPayload | undefined
          const header = decoded?.header as { kid?: string } | undefined

          if (!payload?.iss || !header?.kid) {
            done(new Error('JWT missing iss or kid'))
            return
          }

          const jwksUri = `${payload.iss}/protocol/openid-connect/certs`
          const client = jwksClient({
            jwksUri,
            cache: true,
            cacheMaxAge: 600_000,
            rateLimit: true,
            jwksRequestsPerMinute: 10,
          })

          const signingKey = await client.getSigningKey(header.kid)
          done(null, signingKey.getPublicKey())
        } catch (err) {
          this.logger.warn({ err }, 'JWT key resolution failed')
          done(err instanceof Error ? err : new Error(String(err)))
        }
      },
    })
  }

  /** Extracts tenant slug from iss like "http://localhost:8080/realms/hrobot-acme" → "acme" */
  extractSlug(iss: string): string {
    const match = /\/realms\/hrobot-(.+)$/.exec(iss)
    return match?.[1] ?? ''
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload
  }
}
