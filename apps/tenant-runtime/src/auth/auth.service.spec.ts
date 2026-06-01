import { Test, TestingModule } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service.js'
import { ControlPlanePrismaService } from '../common/prisma/control-plane-prisma.service.js'

jest.mock('@hrobot/config', () => ({
  parseEnv: () => ({
    GLOBAL_ADMIN_JWT_SECRET: 'a'.repeat(32),
    REDIS_URL: 'redis://localhost:6379',
  }),
}))

// Mock bcrypt to avoid native addon requirement in tests
const mockBcryptCompare = jest.fn()
jest.mock('bcrypt', () => ({
  compare: (...args: unknown[]) => mockBcryptCompare(...args),
  hash: jest.fn(),
}))

const mockPrisma = {
  globalAdmin: { findUnique: jest.fn() },
}

describe('AuthService', () => {
  let service: AuthService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ControlPlanePrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get(AuthService)
    jest.clearAllMocks()
  })

  it('returns a JWT when credentials are valid', async () => {
    mockPrisma.globalAdmin.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@hrobot.ai',
      passwordHash: '$2b$10$hashedpassword',
    })
    mockBcryptCompare.mockResolvedValue(true)

    const result = await service.login('admin@hrobot.ai', 'correct-password')
    expect(result.accessToken).toBeDefined()
    expect(typeof result.accessToken).toBe('string')
  })

  it('throws UnauthorizedException for wrong password', async () => {
    mockPrisma.globalAdmin.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@hrobot.ai',
      passwordHash: '$2b$10$hashedpassword',
    })
    mockBcryptCompare.mockResolvedValue(false)

    await expect(service.login('admin@hrobot.ai', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('throws UnauthorizedException when admin not found', async () => {
    mockPrisma.globalAdmin.findUnique.mockResolvedValue(null)
    await expect(service.login('nobody@hrobot.ai', 'any')).rejects.toThrow(
      UnauthorizedException,
    )
  })
})
