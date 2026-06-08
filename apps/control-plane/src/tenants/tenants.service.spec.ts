import { ConflictException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { TenantsService } from './tenants.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

const mockJob = { id: 'job-1' }
const mockTenant = { id: 'tenant-1', slug: 'acme' }

const mockPrisma = {
  tenant: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
}

describe('TenantsService', () => {
  let service: TenantsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get(TenantsService)
    jest.clearAllMocks()
  })

  describe('isSlugAvailable', () => {
    it('returns true when no tenant has the slug', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue(null)
      expect(await service.isSlugAvailable('acme')).toBe(true)
    })

    it('returns false when slug is taken', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValue(mockTenant)
      expect(await service.isSlugAvailable('acme')).toBe(false)
    })
  })

  describe('signup', () => {
    it('returns jobId on successful signup', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<{ jobId: string }>) => {
        return fn({
          tenant: { create: jest.fn().mockResolvedValue(mockTenant) },
          provisioningJob: { create: jest.fn().mockResolvedValue(mockJob) },
          outboxEvent: { create: jest.fn().mockResolvedValue({}) },
        } as unknown as typeof mockPrisma)
      })

      const result = await service.signup({
        companyName: 'Acme Corp',
        slug: 'acme',
        adminEmail: 'admin@acme.com',
      })
      expect(result).toEqual({ jobId: 'job-1' })
    })

    it('throws ConflictException with Polish message on duplicate slug (P2002)', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' })
      mockPrisma.$transaction.mockRejectedValue(p2002)

      await expect(
        service.signup({ companyName: 'Acme', slug: 'acme', adminEmail: 'a@b.com' }),
      ).rejects.toThrow(ConflictException)

      await expect(
        service.signup({ companyName: 'Acme', slug: 'acme', adminEmail: 'a@b.com' }),
      ).rejects.toMatchObject({ response: { message: 'Ta nazwa jest już zajęta' } })
    })
  })
})
