import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { ControlPlanePrisma } from '@hrobot/db'
import { EncryptionService, TenantStatus } from '@hrobot/shared'
import { GlobalAdminGuard } from '../auth/global-admin.guard.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import {
  BOOTSTRAP_ISSUED_AT_KEY,
  BOOTSTRAP_PASSWORD_KEY,
  bootstrapAad,
} from './steps/keycloak-setup.step.js'

@Controller('provision')
export class ProvisioningController {
  constructor(
    private readonly prisma: ControlPlanePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /** 30 req/min/IP — jobId is a secret UUID; still cap polling abuse */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('status/:jobId')
  async status(@Param('jobId') jobId: string): Promise<{
    step: string
    attemptCount: number
    done: boolean
    failed: boolean
    errorCode: string | null
  }> {
    const job = await this.prisma.provisioningJob.findUnique({ where: { id: jobId } })
    if (!job) throw new NotFoundException('Provisioning job not found')
    // Never return raw lastError here: this endpoint is unauthenticated and lastError can
    // contain the tenant DATABASE_URL + password (e.g. prisma migrate stderr). Coarse shape only.
    const failed = job.step === 'FAILED' // matches ProvisioningStep.FAILED

    // W3: `job.step` reaches 'DONE' as KeycloakSetupStep's OWN last write, BEFORE DoneStep — the
    // handler that actually flips tenant.status to ACTIVE — has run at all (DoneStep only runs
    // once ProvisioningService re-emits and a consumer picks the message back up). Reporting
    // `done` from `job.step === 'DONE'` therefore has a window, normally one message round-trip
    // but UNBOUNDED if that re-emit fails, where this endpoint tells the caller the tenant is
    // ready while it is still mid-provisioning. Ground truth is tenant.status, not the job's
    // internal step name — check that instead. FAILED stays terminal on the job row alone: a
    // failed job never gets a tenant to check.
    const tenant = failed ? null : await this.prisma.tenant.findUnique({ where: { id: job.tenantId } })
    const done = failed || tenant?.status === TenantStatus.ACTIVE

    return {
      step: job.step,
      attemptCount: job.attemptCount,
      done,
      failed,
      errorCode: failed ? 'PROVISIONING_FAILED' : null,
    }
  }

  /**
   * G-2: break-glass onboarding path when Keycloak could not deliver the password-reset e-mail
   * (no SMTP in dev, or an SMTP outage in production). KeycloakSetupStep stores the temporary
   * admin password encrypted in tenants.metadata ONLY in that case; this route hands it over
   * exactly once.
   *
   * Why this is safe to expose at all:
   *   - GLOBAL_ADMIN JWT required (GlobalAdminGuard) — this is an operator route, not a tenant
   *     route, and the control-plane is otherwise only publicly reachable for signup/status;
   *   - the secret is AES-256-GCM encrypted at rest, AAD-bound to the tenant id;
   *   - ONE-TIME: the ciphertext is wiped from metadata in the same request that reveals it, so a
   *     replay returns 404 and a leaked log of the URL is worthless;
   *   - the credential itself is Keycloak-`temporary`, so first login forces a password change;
   *   - it is returned in the response body only — deliberately never logged, and deliberately
   *     absent from the unauthenticated `status` route above.
   */
  @UseGuards(GlobalAdminGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('bootstrap-credentials/:tenantId')
  async bootstrapCredentials(@Param('tenantId') tenantId: string): Promise<{
    username: string
    password: string
    issuedAt: string | null
  }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Tenant not found')

    const meta = (tenant.metadata ?? {}) as Record<string, unknown>
    const blob = meta[BOOTSTRAP_PASSWORD_KEY]
    if (typeof blob !== 'string' || blob.length === 0) {
      // Either the reset e-mail went out normally, or this credential was already collected.
      throw new NotFoundException('No bootstrap credential is pending for this tenant')
    }

    const password = this.encryption.decrypt(blob, bootstrapAad(tenantId))
    const issuedAt = typeof meta[BOOTSTRAP_ISSUED_AT_KEY] === 'string'
      ? (meta[BOOTSTRAP_ISSUED_AT_KEY] as string)
      : null

    // Burn it: revealed once, then gone. Done after a successful decrypt so a wrong-key/corrupt
    // blob surfaces as an error instead of silently destroying the only onboarding path.
    const nextMeta = { ...meta }
    delete nextMeta[BOOTSTRAP_PASSWORD_KEY]
    delete nextMeta[BOOTSTRAP_ISSUED_AT_KEY]
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { metadata: nextMeta as ControlPlanePrisma.InputJsonObject },
    })

    return {
      username: String(meta['adminEmail'] ?? ''),
      password,
      issuedAt,
    }
  }
}
