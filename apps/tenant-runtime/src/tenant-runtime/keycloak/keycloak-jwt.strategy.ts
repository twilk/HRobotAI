import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
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
  /** Authorized party — the client the token was actually minted for. */
  azp?: string
  /** Audience. Keycloak defaults this to "account" unless an audience mapper is configured. */
  aud?: string | string[]
  [key: string]: unknown
}

type JwtDoneCallback = (err: Error | null, key?: string) => void

/** Kept in lockstep with the KEYCLOAK_ALLOWED_AZP default in packages/config env.ts. */
const DEFAULT_ALLOWED_AZP = 'hrobot-web'

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

  /**
   * Q10 — audience / authorized-party check.
   *
   * `isTrustedIssuer` proves the token came from OUR Keycloak and a real tenant realm, but says
   * nothing about WHICH client minted it. Without this second check, any client in that realm is
   * as good as the web app: a tenant admin who creates an OIDC client for some unrelated
   * integration gets tokens the tenant API honours in full.
   *
   * `azp` is the claim that carries the answer. `aud` is checked only as a fallback, because
   * Keycloak leaves `aud` as "account" unless an audience mapper is configured — a live demo token
   * really does read `aud: "account", azp: "hrobot-web"`, so an `aud`-only rule would reject every
   * legitimate request.
   *
   * A token with neither claim is rejected: no client identity means nothing to authorize.
   */
  isAllowedClient(payload: Pick<JwtPayload, 'azp' | 'aud'>, allowed: readonly string[]): boolean {
    if (allowed.length === 0) return false
    if (typeof payload.azp === 'string' && payload.azp.length > 0) {
      return allowed.includes(payload.azp)
    }
    const aud = payload.aud
    if (typeof aud === 'string') return allowed.includes(aud)
    if (Array.isArray(aud)) return aud.some((a) => allowed.includes(a))
    return false
  }

  /**
   * Read straight from process.env, NOT via parseEnv(). parseEnv() validates the whole environment
   * and throws when anything unrelated is missing — on the request path that would turn one
   * misconfigured variable into a 500 for every authenticated call, and it would make this strategy
   * impossible to unit-test without a fully populated environment. The variable's shape and default
   * are still declared in packages/config env.ts, which is what boot-time validation enforces.
   */
  private get allowedClients(): readonly string[] {
    return (process.env.KEYCLOAK_ALLOWED_AZP ?? DEFAULT_ALLOWED_AZP)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  /** Runs AFTER signature + expiry verification, so these claims are trustworthy here. */
  validate(payload: JwtPayload): JwtPayload {
    if (!this.isAllowedClient(payload, this.allowedClients)) {
      // Log the rejected client for forensics; never echo it back to the caller.
      this.logger.warn(
        { azp: payload.azp, aud: payload.aud, iss: payload.iss },
        'Rejected token from a non-allowlisted client',
      )
      throw new UnauthorizedException('Token was not issued for this application')
    }
    return payload
  }
}
