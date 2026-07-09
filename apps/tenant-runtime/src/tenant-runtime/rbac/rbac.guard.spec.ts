import { Reflector } from '@nestjs/core'
import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { RbacGuard } from './rbac.guard.js'

function makeCtx(roles: string[]): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { hrobot_roles: roles } }) }),
    getClass: () => ({}),
    getHandler: () => ({}),
  } as unknown as ExecutionContext
}

describe('RbacGuard', () => {
  let guard: RbacGuard
  let reflector: Reflector

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RbacGuard, Reflector],
    }).compile()
    guard = module.get(RbacGuard)
    reflector = module.get(Reflector)
  })

  it('allows access when no @Roles decorator is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined)
    expect(guard.canActivate(makeCtx([]))).toBe(true)
  })

  it('allows access when user has a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['HR', 'ADMIN_KLIENTA'])
    expect(guard.canActivate(makeCtx(['ADMIN_KLIENTA']))).toBe(true)
  })

  it('throws ForbiddenException when user lacks all required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN_KLIENTA'])
    expect(() => guard.canActivate(makeCtx(['PRACOWNIK']))).toThrow(ForbiddenException)
  })

  it('throws ForbiddenException when user has no roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['HR'])
    expect(() => guard.canActivate(makeCtx([]))).toThrow(ForbiddenException)
  })
})
