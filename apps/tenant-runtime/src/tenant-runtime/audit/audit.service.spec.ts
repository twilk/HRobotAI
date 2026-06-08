import { Test, TestingModule } from '@nestjs/testing'
import { AuditService, AuditLogInput } from './audit.service.js'
import type { TenantClient } from '@hrobot/db'

describe('AuditService', () => {
  let service: AuditService
  const mockCreate = jest.fn()
  const mockTenantClient = { auditLog: { create: mockCreate } } as unknown as TenantClient

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService],
    }).compile()
    service = module.get(AuditService)
    jest.clearAllMocks()
  })

  it('calls auditLog.create with the correct payload shape', async () => {
    mockCreate.mockResolvedValue({ id: 'log-1' })
    const input: AuditLogInput = {
      tenantClient: mockTenantClient,
      actorUserId: 'user-uuid-1',
      action: 'employee.update',
      entityType: 'Employee',
      entityId: 'emp-uuid-1',
      payload: { before: { position: 'Junior' }, after: { position: 'Senior' } },
      ipAddress: '127.0.0.1',
    }

    await service.log(input)

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user-uuid-1',
        action: 'employee.update',
        entityType: 'Employee',
        entityId: 'emp-uuid-1',
        payload: { before: { position: 'Junior' }, after: { position: 'Senior' } },
        ipAddress: '127.0.0.1',
      },
    })
  })

  it('does not throw and skips write when tenantClient is null', async () => {
    await expect(
      service.log({
        tenantClient: null as unknown as TenantClient,
        actorUserId: 'u',
        action: 'x',
        entityType: 'T',
        entityId: 'id',
        payload: {},
        ipAddress: '0.0.0.0',
      }),
    ).resolves.toBeUndefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
