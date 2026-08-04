import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { EncryptionService } from '@hrobot/shared'
import { ProvisioningController } from './provisioning.controller.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'
import {
  BOOTSTRAP_ISSUED_AT_KEY,
  BOOTSTRAP_PASSWORD_KEY,
  bootstrapAad,
} from './steps/keycloak-setup.step.js'

const encryption = new EncryptionService(Buffer.from('a'.repeat(64), 'hex'))

const mockPrisma = {
  provisioningJob: { findUnique: jest.fn() },
  tenant: { findUnique: jest.fn(), update: jest.fn() },
}

describe('ProvisioningController', () => {
  let controller: ProvisioningController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProvisioningController],
      providers: [
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: encryption },
      ],
    }).compile()
    controller = module.get(ProvisioningController)
    jest.clearAllMocks()
    mockPrisma.tenant.update.mockResolvedValue({})
  })

  describe('status', () => {
    it('never leaks lastError on the unauthenticated status route', async () => {
      mockPrisma.provisioningJob.findUnique.mockResolvedValue({
        step: 'FAILED',
        attemptCount: 3,
        lastError: 'postgresql://hu_x:sup3rs3cret@db:5432/hrobot_t_x refused',
      })

      const result = await controller.status('job-1')

      expect(JSON.stringify(result)).not.toContain('sup3rs3cret')
      expect(result).toEqual({
        step: 'FAILED',
        attemptCount: 3,
        done: true,
        failed: true,
        errorCode: 'PROVISIONING_FAILED',
      })
    })

    /**
     * W3 — KeycloakSetupStep writes `job.step = DONE` as ITS OWN last write (see
     * keycloak-setup.step.ts), before DoneStep — the handler that actually flips tenant.status to
     * ACTIVE — has run at all. DoneStep only runs once ProvisioningService re-emits the follow-up
     * message and a consumer picks it back up. In that window (normally one message round-trip,
     * unbounded if the re-emit fails) `job.step` already reads 'DONE' while the tenant is still
     * mid-provisioning. THE PROPERTY: this endpoint must reflect tenant.status (ground truth), not
     * merely the job's internal step name.
     */
    it('does not report done:true while job.step=DONE but the tenant is not yet ACTIVE (W3)', async () => {
      mockPrisma.provisioningJob.findUnique.mockResolvedValue({
        step: 'DONE',
        attemptCount: 0,
        lastError: null,
        tenantId: 'tenant-1',
      })
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', status: 'PROVISIONING' })

      const result = await controller.status('job-1')

      expect(result.done).toBe(false)
    })

    it('reports done:true once the tenant is actually ACTIVE', async () => {
      mockPrisma.provisioningJob.findUnique.mockResolvedValue({
        step: 'DONE',
        attemptCount: 0,
        lastError: null,
        tenantId: 'tenant-1',
      })
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' })

      const result = await controller.status('job-1')

      expect(result.done).toBe(true)
    })
  })

  /**
   * G-2: the operator-only break-glass path used when Keycloak could not send the reset e-mail.
   * The route itself is gated by GlobalAdminGuard (wired in the controller decorator; these
   * specs exercise the handler body, where the ONE-TIME and never-leak guarantees live).
   */
  describe('bootstrapCredentials', () => {
    const tenantWithCredential = (blob: string) => ({
      id: 'tenant-1',
      metadata: {
        adminEmail: 'admin@acme.com',
        [BOOTSTRAP_PASSWORD_KEY]: blob,
        [BOOTSTRAP_ISSUED_AT_KEY]: '2026-08-03T21:00:00.000Z',
      },
    })

    it('returns the decrypted credential and BURNS it in the same request', async () => {
      const blob = encryption.encrypt('t3mp-p4ss', bootstrapAad('tenant-1'))
      mockPrisma.tenant.findUnique.mockResolvedValue(tenantWithCredential(blob))

      const result = await controller.bootstrapCredentials('tenant-1')

      expect(result).toEqual({
        username: 'admin@acme.com',
        password: 't3mp-p4ss',
        issuedAt: '2026-08-03T21:00:00.000Z',
      })
      // One-time: the ciphertext is gone from metadata, so a replay of this URL is worthless.
      const written = (mockPrisma.tenant.update.mock.calls[0]?.[0] as {
        data: { metadata: Record<string, unknown> }
      }).data.metadata
      expect(written).not.toHaveProperty(BOOTSTRAP_PASSWORD_KEY)
      expect(written).not.toHaveProperty(BOOTSTRAP_ISSUED_AT_KEY)
      // Unrelated metadata survives.
      expect(written['adminEmail']).toBe('admin@acme.com')
    })

    it('404s when no credential is pending (e-mail went out, or it was already collected)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        metadata: { adminEmail: 'admin@acme.com' },
      })

      await expect(controller.bootstrapCredentials('tenant-1')).rejects.toBeInstanceOf(
        NotFoundException,
      )
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled()
    })

    it('404s for an unknown tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null)

      await expect(controller.bootstrapCredentials('nope')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('does not destroy the credential when decryption fails (wrong key / tampered blob)', async () => {
      // Encrypted for a DIFFERENT tenant → the AAD binding rejects it here.
      const foreign = encryption.encrypt('t3mp-p4ss', bootstrapAad('tenant-2'))
      mockPrisma.tenant.findUnique.mockResolvedValue(tenantWithCredential(foreign))

      await expect(controller.bootstrapCredentials('tenant-1')).rejects.toThrow()
      // The only onboarding path must not be wiped by a failed read.
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled()
    })
  })
})
