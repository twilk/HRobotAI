import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Observable, tap } from 'rxjs'
import type { TenantClient } from '@hrobot/db'
import { AuditService } from './audit.service.js'
import type { JwtPayload } from '../keycloak/keycloak-jwt.strategy.js'

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

// P3-4 (RODO): the audit_log is append-only/immutable (DB trigger), so PII written there can
// never be erased or rectified. Recursively redact sensitive fields from request bodies before
// they are persisted — pesel (Polish national ID) above all, plus credentials/tokens.
const SENSITIVE_KEYS = new Set([
  'pesel', 'password', 'passwordhash', 'token', 'accesstoken', 'refreshtoken', 'secret', 'ssn',
])
export function redactAuditPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditPayload)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        SENSITIVE_KEYS.has(k.toLowerCase()) ? [k, '***'] : [k, redactAuditPayload(v)],
      ),
    )
  }
  return value
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name)

  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{
      method: string
      path: string
      ip: string
      body: unknown
      params: Record<string, string>
      user: JwtPayload
      tenantClient: TenantClient
    }>()

    if (!MUTATING.has(req.method.toUpperCase())) return next.handle()

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit
            .log({
              tenantClient: req.tenantClient,
              actorUserId: req.user?.sub ?? 'anonymous',
              action: `${req.method.toLowerCase()}.${req.path}`,
              entityType: 'Request',
              entityId: req.path,
              payload: { body: redactAuditPayload(req.body), params: req.params },
              ipAddress: req.ip ?? '0.0.0.0',
            })
            .catch((err: Error) => this.logger.error({ err }, 'Failed to write audit log'))
        },
      }),
    )
  }
}
