import { Injectable, Logger } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import * as jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { parseEnv } from '@hrobot/config'

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

          // FIX-P3-1 (CRITICAL): iss is attacker-controlled (this is an UNVERIFIED decode).
          // Reject any issuer that isn't our Keycloak host + a valid tenant realm slug BEFORE
          // fetching its JWKS — otherwise an attacker hosts their own JWKS and forges a valid
          // token for any tenant/role (full auth bypass + cross-tenant PII access).
          if (!this.isTrustedIssuer(payload.iss, parseEnv().KEYCLOAK_URL)) {
            done(new Error('Untrusted token issuer'))
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

  /**
   * True only if `iss` is our Keycloak host (`base`) followed by a well-formed tenant realm
   * (`/realms/hrobot-<slug>`), where <slug> matches the signup slug shape. A bare
   * startsWith('.../realms/hrobot-') would admit `hrobot-acme.evil` or a trailing path, so the
   * full tail is matched + anchored. This is the guard that stops a forged token from pointing
   * JWKS resolution at an attacker-controlled host.
   */
  isTrustedIssuer(iss: string, base: string): boolean {
    if (!iss.startsWith(base)) return false
    return /^\/realms\/hrobot-[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(iss.slice(base.length))
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload
  }
}
