import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { UsersService, type UsersActor } from './users.service.js'
import { AuditService } from '../tenant-runtime/audit/audit.service.js'
import { KeycloakAdminService } from '../tenant-runtime/keycloak/keycloak-admin.service.js'

const REALM = 'hrobot-acme'

/** A mock tenant client exposing exactly the delegates UsersService touches. */
function makeClient() {
  return {
    user: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    userRole: { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  }
}
type MockClient = ReturnType<typeof makeClient>
const asClient = (c: MockClient): TenantClient => c as unknown as TenantClient

const ADMIN: UsersActor = { userId: 'kc-admin', roles: [Role.ADMIN_KLIENTA], ipAddress: '10.0.0.1' }
const HR: UsersActor = { userId: 'kc-hr', roles: [Role.HR], ipAddress: '10.0.0.2' }
const PRACOWNIK: UsersActor = { userId: 'kc-emp', roles: [Role.PRACOWNIK], ipAddress: '10.0.0.3' }

const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })

describe('UsersService', () => {
  let service: UsersService
  let audit: { log: jest.Mock }
  let keycloak: {
    createUser: jest.Mock
    assignRealmRole: jest.Mock
    removeRealmRole: jest.Mock
    setEnabled: jest.Mock
    sendPasswordSetupEmail: jest.Mock
    getUserRealmRoles: jest.Mock
  }
  let client: MockClient

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    keycloak = {
      createUser: jest.fn().mockResolvedValue({ kcId: 'kc-new-user', created: true }),
      assignRealmRole: jest.fn().mockResolvedValue(undefined),
      removeRealmRole: jest.fn().mockResolvedValue(undefined),
      setEnabled: jest.fn().mockResolvedValue(undefined),
      sendPasswordSetupEmail: jest.fn().mockResolvedValue(undefined),
      getUserRealmRoles: jest.fn().mockResolvedValue([]),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: AuditService, useValue: audit },
        { provide: KeycloakAdminService, useValue: keycloak },
      ],
    }).compile()
    service = module.get(UsersService)
    client = makeClient()
    jest.clearAllMocks()
    keycloak.createUser.mockResolvedValue({ kcId: 'kc-new-user', created: true })
    // `guardedAdminMutation` runs its count-check + mutate callback inside `client.$transaction(fn, opts)`;
    // for these mocks `tx` is just `client` itself, so `tx.userRole.findMany`/`tx.user.update` etc. hit the
    // same jest mocks the tests already set up on `client`.
    client.$transaction.mockImplementation(async (fn: (tx: MockClient) => unknown) => fn(client))
    // Default: no sibling unit-scoped grant of the same role survives — `revokeInternal` proceeds
    // to remove the KC mapping, matching the pre-existing (single-unit) test expectations below.
    client.userRole.count.mockResolvedValue(0)
  })

  describe('invite', () => {
    beforeEach(() => {
      // `resolveActingUser` (via `requireRealAdmin`) AND Fix 1(a)'s pre-existing-email check both go
      // through `client.user.findFirst` — the actor lookup is keyed by `keycloakSub`, the duplicate-
      // email check by `email`, so a single mock that only recognizes the actor's `keycloakSub` filter
      // and defaults to "no existing user" for every other call keeps both paths independently testable.
      client.user.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if ('keycloakSub' in where) return { id: 'admin-db-id', active: true, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] }
        return null
      })
    })

    it('happy path: creates the KC user, the tenant User (keycloakSub=kcId), GRANTs the role in order, and emails the setup link', async () => {
      client.user.create.mockResolvedValue({ id: 'user-1', email: 'new@acme.com', active: true, createdAt: new Date(), roles: [] })
      client.userRole.create.mockResolvedValue({})

      const calls: string[] = []
      keycloak.createUser.mockImplementation(async () => { calls.push('kc.createUser'); return { kcId: 'kc-new-user', created: true } })
      client.user.create.mockImplementation(async () => { calls.push('db.user.create'); return { id: 'user-1', email: 'new@acme.com', active: true, createdAt: new Date(), roles: [] } })
      client.userRole.create.mockImplementation(async () => { calls.push('db.userRole.create') })
      keycloak.assignRealmRole.mockImplementation(async () => { calls.push('kc.assignRealmRole') })
      keycloak.sendPasswordSetupEmail.mockImplementation(async () => { calls.push('kc.sendPasswordSetupEmail') })

      const result = await service.invite(asClient(client), ADMIN, REALM, 'new@acme.com', Role.MANAGER, null)

      expect(calls).toEqual(['kc.createUser', 'db.user.create', 'db.userRole.create', 'kc.assignRealmRole', 'kc.sendPasswordSetupEmail'])
      expect(client.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'new@acme.com', keycloakSub: 'kc-new-user', active: true }) }),
      )
      expect(client.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-1', role: Role.MANAGER, unitId: null } })
      expect(keycloak.assignRealmRole).toHaveBeenCalledWith(REALM, 'kc-new-user', Role.MANAGER)
      expect(result.id).toBe('user-1')
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.invited', entityId: 'user-1' }))
    })

    it('audits user.invited ids-only — never the invitee email (RODO)', async () => {
      client.user.create.mockResolvedValue({ id: 'user-1', email: 'new@acme.com', active: true, createdAt: new Date(), roles: [] })
      client.userRole.create.mockResolvedValue({})

      await service.invite(asClient(client), ADMIN, REALM, 'new@acme.com', Role.MANAGER, null)

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.invited', payload: { role: Role.MANAGER, unitId: null } }),
      )
      const payload = audit.log.mock.calls[0][0].payload
      expect(payload).not.toHaveProperty('email')
      expect(JSON.stringify(payload)).not.toContain('new@acme.com')
    })

    it('DB-fail-after-KC-create compensates via setEnabled(false), never deletes, and rethrows a 409 for a duplicate email', async () => {
      client.user.create.mockRejectedValue(p2002)

      await expect(service.invite(asClient(client), ADMIN, REALM, 'dup@acme.com', Role.MANAGER)).rejects.toThrow(ConflictException)

      expect(keycloak.setEnabled).toHaveBeenCalledWith(REALM, 'kc-new-user', false)
      expect(client.userRole.create).not.toHaveBeenCalled()
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
    })

    it('does not let a failed compensation (setEnabled itself throwing) mask the original DB error', async () => {
      client.user.create.mockRejectedValue(p2002)
      keycloak.setEnabled.mockRejectedValue(new Error('keycloak unreachable'))

      await expect(service.invite(asClient(client), ADMIN, REALM, 'dup@acme.com', Role.MANAGER)).rejects.toThrow(ConflictException)
      expect(keycloak.setEnabled).toHaveBeenCalledWith(REALM, 'kc-new-user', false)
    })

    it('grant KC-fail leaves a safe dangling UserRole (already committed) and propagates the error', async () => {
      client.user.create.mockResolvedValue({ id: 'user-1', email: 'new@acme.com', active: true, createdAt: new Date(), roles: [] })
      client.userRole.create.mockResolvedValue({})
      keycloak.assignRealmRole.mockRejectedValue(new Error('keycloak 500'))

      await expect(service.invite(asClient(client), ADMIN, REALM, 'new@acme.com', Role.MANAGER)).rejects.toThrow('keycloak 500')

      expect(client.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-1', role: Role.MANAGER, unitId: null } })
      expect(keycloak.sendPasswordSetupEmail).not.toHaveBeenCalled()
    })

    it('FIX 1(a): 409s BEFORE any Keycloak call when a tenant User already exists for the email, and never disables anyone', async () => {
      client.user.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if ('keycloakSub' in where) return { id: 'admin-db-id', active: true, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] }
        if ('email' in where) return { id: 'existing-user-id', email: 'dup@acme.com' }
        return null
      })

      await expect(service.invite(asClient(client), ADMIN, REALM, 'dup@acme.com', Role.MANAGER)).rejects.toThrow(ConflictException)

      expect(keycloak.createUser).not.toHaveBeenCalled()
      expect(client.user.create).not.toHaveBeenCalled()
      expect(keycloak.setEnabled).not.toHaveBeenCalled()
    })

    it('FIX 1(b): when createUser resolves an EXISTING kcId (created:false) and the DB write then fails, setEnabled(false) is NOT called', async () => {
      keycloak.createUser.mockResolvedValue({ kcId: 'kc-existing-unrelated-user', created: false })
      client.user.create.mockRejectedValue(p2002)

      await expect(service.invite(asClient(client), ADMIN, REALM, 'dup@acme.com', Role.MANAGER)).rejects.toThrow(ConflictException)

      expect(keycloak.setEnabled).not.toHaveBeenCalled()
      expect(client.userRole.create).not.toHaveBeenCalled()
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
    })

    it('403s BEFORE any Keycloak call for a non-admin actor', async () => {
      await expect(service.invite(asClient(client), HR, REALM, 'new@acme.com', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(keycloak.createUser).not.toHaveBeenCalled()
      expect(client.user.create).not.toHaveBeenCalled()
    })

    it('403s a stale JWT whose real DB role was demoted from ADMIN_KLIENTA, BEFORE any Keycloak call', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.HR, unitId: null }] })

      await expect(service.invite(asClient(client), ADMIN, REALM, 'new@acme.com', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(keycloak.createUser).not.toHaveBeenCalled()
      expect(client.user.create).not.toHaveBeenCalled()
    })

    it('403s a stale JWT whose real DB user is no longer active, BEFORE any Keycloak call', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: false, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })

      await expect(service.invite(asClient(client), ADMIN, REALM, 'new@acme.com', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(keycloak.createUser).not.toHaveBeenCalled()
      expect(client.user.create).not.toHaveBeenCalled()
    })

    it('FIX 2(a): rejects an ADMIN_KLIENTA invite with a non-null unitId — ADMIN_KLIENTA is always global', async () => {
      await expect(service.invite(asClient(client), ADMIN, REALM, 'new@acme.com', Role.ADMIN_KLIENTA, 'unit-A')).rejects.toThrow(
        BadRequestException,
      )
      expect(keycloak.createUser).not.toHaveBeenCalled()
      expect(client.user.create).not.toHaveBeenCalled()
    })
  })

  describe('assignRole (GRANT)', () => {
    beforeEach(() => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
      client.user.findUnique.mockResolvedValue({ id: 'target-1', keycloakSub: 'kc-target-1' })
      client.userRole.create.mockResolvedValue({})
    })

    it('FIX 2(a): rejects granting ADMIN_KLIENTA with a non-null unitId — ADMIN_KLIENTA is always global', async () => {
      await expect(
        service.assignRole(asClient(client), ADMIN, REALM, 'target-1', Role.ADMIN_KLIENTA, 'unit-A'),
      ).rejects.toThrow(BadRequestException)
      expect(client.userRole.create).not.toHaveBeenCalled()
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
    })

    it('writes UserRole THEN calls KC assignRealmRole, in that order', async () => {
      const calls: string[] = []
      client.userRole.create.mockImplementation(async () => { calls.push('db.userRole.create') })
      keycloak.assignRealmRole.mockImplementation(async () => { calls.push('kc.assignRealmRole') })

      await service.assignRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER, 'unit-A')

      expect(calls).toEqual(['db.userRole.create', 'kc.assignRealmRole'])
      expect(client.userRole.create).toHaveBeenCalledWith({ data: { userId: 'target-1', role: Role.MANAGER, unitId: 'unit-A' } })
      expect(keycloak.assignRealmRole).toHaveBeenCalledWith(REALM, 'kc-target-1', Role.MANAGER)
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.assigned', entityId: 'target-1' }))
    })

    it('leaves a safe dangling UserRole when the KC grant fails', async () => {
      keycloak.assignRealmRole.mockRejectedValue(new Error('keycloak 500'))
      await expect(service.assignRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER)).rejects.toThrow('keycloak 500')
      expect(client.userRole.create).toHaveBeenCalled()
    })

    it('global-role idempotency: a second HR grant tolerates the P2002 unique violation as a no-op and still (re-)asserts the KC mapping', async () => {
      client.userRole.create.mockResolvedValueOnce({}).mockRejectedValueOnce(p2002)

      await service.assignRole(asClient(client), ADMIN, REALM, 'target-1', Role.HR, null)
      await service.assignRole(asClient(client), ADMIN, REALM, 'target-1', Role.HR, null)

      expect(client.userRole.create).toHaveBeenCalledTimes(2)
      expect(keycloak.assignRealmRole).toHaveBeenCalledTimes(2)
    })

    it('403s before any DB/KC call for a non-admin actor', async () => {
      await expect(service.assignRole(asClient(client), PRACOWNIK, REALM, 'target-1', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(client.user.findFirst).not.toHaveBeenCalled()
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
    })

    it('403s a stale JWT whose real DB user is no longer active', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: false, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
      await expect(service.assignRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(client.userRole.create).not.toHaveBeenCalled()
    })

    it('403s a stale JWT whose real DB role was demoted from ADMIN_KLIENTA, even when granting a role to SOMEONE ELSE', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.HR, unitId: null }] })
      await expect(service.assignRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(client.user.findUnique).not.toHaveBeenCalled()
      expect(client.userRole.create).not.toHaveBeenCalled()
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
    })

    it('404s an unknown target user', async () => {
      client.user.findUnique.mockResolvedValue(null)
      await expect(service.assignRole(asClient(client), ADMIN, REALM, 'ghost', Role.MANAGER)).rejects.toThrow(NotFoundException)
    })

    it('blocks SELF-ESCALATION: a stale-JWT admin whose real DB role is only HR cannot re-grant themselves ADMIN_KLIENTA', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.HR, unitId: null }] })
      client.user.findUnique.mockResolvedValue({ id: 'admin-db-id', keycloakSub: 'kc-admin' })

      await expect(service.assignRole(asClient(client), ADMIN, REALM, 'admin-db-id', Role.ADMIN_KLIENTA, null)).rejects.toThrow(ForbiddenException)
      expect(client.userRole.create).not.toHaveBeenCalled()
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
    })

    it('allows self-granting a role at or below the actor’s own real rank (idempotent re-assign, not escalation)', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
      client.user.findUnique.mockResolvedValue({ id: 'admin-db-id', keycloakSub: 'kc-admin' })

      await expect(service.assignRole(asClient(client), ADMIN, REALM, 'admin-db-id', Role.ADMIN_KLIENTA, null)).resolves.toBeUndefined()
    })
  })

  describe('revokeRole (REVOKE)', () => {
    beforeEach(() => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
      client.user.findUnique.mockResolvedValue({ id: 'target-1', keycloakSub: 'kc-target-1' })
      client.userRole.deleteMany.mockResolvedValue({ count: 1 })
    })

    it('calls KC removeRealmRole THEN deletes UserRole, in that order', async () => {
      const calls: string[] = []
      keycloak.removeRealmRole.mockImplementation(async () => { calls.push('kc.removeRealmRole') })
      client.userRole.deleteMany.mockImplementation(async () => { calls.push('db.userRole.deleteMany'); return { count: 1 } })

      await service.revokeRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER, 'unit-A')

      expect(calls).toEqual(['kc.removeRealmRole', 'db.userRole.deleteMany'])
      expect(keycloak.removeRealmRole).toHaveBeenCalledWith(REALM, 'kc-target-1', Role.MANAGER)
      expect(client.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target-1', role: Role.MANAGER, unitId: 'unit-A' } })
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.revoked', entityId: 'target-1' }))
    })

    it('aborts BEFORE deleting UserRole when the KC removal fails', async () => {
      keycloak.removeRealmRole.mockRejectedValue(new Error('keycloak 500'))
      await expect(service.revokeRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER)).rejects.toThrow('keycloak 500')
      expect(client.userRole.deleteMany).not.toHaveBeenCalled()
    })

    it('404s an unknown target user', async () => {
      client.user.findUnique.mockResolvedValue(null)
      await expect(service.revokeRole(asClient(client), ADMIN, REALM, 'ghost', Role.MANAGER)).rejects.toThrow(NotFoundException)
    })

    it('LAST-ADMIN: blocks revoking the sole remaining global ADMIN_KLIENTA', async () => {
      client.user.findUnique.mockResolvedValue({ id: 'sole-admin', keycloakSub: 'kc-sole-admin' })
      client.userRole.findMany.mockResolvedValue([{ userId: 'sole-admin' }])

      await expect(service.revokeRole(asClient(client), ADMIN, REALM, 'sole-admin', Role.ADMIN_KLIENTA, null)).rejects.toThrow(ConflictException)
      expect(keycloak.removeRealmRole).not.toHaveBeenCalled()
    })

    it('FIX 2(b): the last-admin count is ROLE-BASED ONLY (no unitId filter) — blocks even a hypothetical unit-scoped ADMIN_KLIENTA row for the sole admin', async () => {
      client.user.findUnique.mockResolvedValue({ id: 'sole-admin', keycloakSub: 'kc-sole-admin' })
      client.userRole.findMany.mockResolvedValue([{ userId: 'sole-admin' }])

      await expect(
        service.revokeRole(asClient(client), ADMIN, REALM, 'sole-admin', Role.ADMIN_KLIENTA, 'unit-X'),
      ).rejects.toThrow(ConflictException)

      expect(keycloak.removeRealmRole).not.toHaveBeenCalled()
      expect(client.userRole.findMany).toHaveBeenCalledWith({
        where: { role: Role.ADMIN_KLIENTA, user: { active: true } },
        select: { userId: true },
      })
    })

    it('allows revoking ADMIN_KLIENTA when another active admin remains', async () => {
      client.user.findUnique.mockResolvedValue({ id: 'admin-2', keycloakSub: 'kc-admin-2' })
      client.userRole.findMany.mockResolvedValue([{ userId: 'admin-2' }, { userId: 'admin-3' }])

      await expect(service.revokeRole(asClient(client), ADMIN, REALM, 'admin-2', Role.ADMIN_KLIENTA, null)).resolves.toBeUndefined()
      expect(keycloak.removeRealmRole).toHaveBeenCalled()
    })

    it('LAST-ADMIN TOCTOU: a concurrent write-skew detected by Postgres (P2034) is surfaced as a 409, not silently allowed', async () => {
      client.user.findUnique.mockResolvedValue({ id: 'admin-2', keycloakSub: 'kc-admin-2' })
      client.userRole.findMany.mockResolvedValue([{ userId: 'admin-2' }, { userId: 'admin-3' }])
      client.$transaction.mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))

      await expect(service.revokeRole(asClient(client), ADMIN, REALM, 'admin-2', Role.ADMIN_KLIENTA, null)).rejects.toThrow(ConflictException)
    })

    it('403s a stale JWT whose real DB role was demoted from ADMIN_KLIENTA, even when revoking a role from SOMEONE ELSE', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.HR, unitId: null }] })
      await expect(service.revokeRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(client.user.findUnique).not.toHaveBeenCalled()
      expect(keycloak.removeRealmRole).not.toHaveBeenCalled()
    })

    it('403s before any DB/KC call for a non-admin actor', async () => {
      await expect(service.revokeRole(asClient(client), HR, REALM, 'target-1', Role.MANAGER)).rejects.toThrow(ForbiddenException)
      expect(keycloak.removeRealmRole).not.toHaveBeenCalled()
    })

    it('SIBLING-AWARE: does NOT remove the KC realm-role mapping when the same role survives in another unit', async () => {
      client.userRole.count.mockResolvedValue(1) // MANAGER still held in another unit (e.g. unit-B)

      await service.revokeRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER, 'unit-A')

      expect(client.userRole.count).toHaveBeenCalledWith({ where: { userId: 'target-1', role: Role.MANAGER, unitId: { not: 'unit-A' } } })
      expect(keycloak.removeRealmRole).not.toHaveBeenCalled()
      expect(client.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target-1', role: Role.MANAGER, unitId: 'unit-A' } })
    })

    it('SIBLING-AWARE: DOES remove the KC realm-role mapping when no sibling unit-scoped grant remains', async () => {
      client.userRole.count.mockResolvedValue(0)

      await service.revokeRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER, 'unit-A')

      expect(keycloak.removeRealmRole).toHaveBeenCalledWith(REALM, 'kc-target-1', Role.MANAGER)
    })

    it('a user holding the same role in two units, revoked from one: KC mapping and the surviving row stay intact, and reconcile finds nothing to fix', async () => {
      client.userRole.count.mockResolvedValue(1) // the unit-B row survives the unit-A revoke

      await service.revokeRole(asClient(client), ADMIN, REALM, 'target-1', Role.MANAGER, 'unit-A')

      expect(keycloak.removeRealmRole).not.toHaveBeenCalled()
      expect(client.userRole.deleteMany).toHaveBeenCalledTimes(1)

      // Reconcile afterwards: KC still reports MANAGER (mapping was never touched) and the DB still
      // has the surviving unit-B row — they agree, so reconcile must report nothing and must NOT
      // delete the surviving legitimate row.
      client.user.findMany.mockResolvedValue([{ id: 'target-1', keycloakSub: 'kc-target-1', roles: [{ role: Role.MANAGER }] }])
      keycloak.getUserRealmRoles.mockResolvedValue(['MANAGER'])

      const result = await service.reconcile(asClient(client), ADMIN, REALM, { fix: true })

      expect(result.findings).toEqual([])
      expect(result.fixedCount).toBe(0)
      // Only the revoke's own scoped delete happened — reconcile issued no further deleteMany calls.
      expect(client.userRole.deleteMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('deactivate', () => {
    beforeEach(() => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
      client.user.findUnique.mockResolvedValue({ id: 'target-1', keycloakSub: 'kc-target-1', roles: [] })
    })

    it('disables the KC user THEN flips User.active=false', async () => {
      const calls: string[] = []
      keycloak.setEnabled.mockImplementation(async () => { calls.push('kc.setEnabled') })
      client.user.update.mockImplementation(async () => { calls.push('db.user.update') })

      await service.deactivate(asClient(client), ADMIN, REALM, 'target-1')

      expect(calls).toEqual(['kc.setEnabled', 'db.user.update'])
      expect(keycloak.setEnabled).toHaveBeenCalledWith(REALM, 'kc-target-1', false)
      expect(client.user.update).toHaveBeenCalledWith({ where: { id: 'target-1' }, data: { active: false } })
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.deactivated', entityId: 'target-1' }))
    })

    it('leaves the user fully active when the KC setEnabled call fails', async () => {
      keycloak.setEnabled.mockRejectedValue(new Error('keycloak 500'))
      await expect(service.deactivate(asClient(client), ADMIN, REALM, 'target-1')).rejects.toThrow('keycloak 500')
      expect(client.user.update).not.toHaveBeenCalled()
    })

    it('404s an unknown target user', async () => {
      client.user.findUnique.mockResolvedValue(null)
      await expect(service.deactivate(asClient(client), ADMIN, REALM, 'ghost')).rejects.toThrow(NotFoundException)
    })

    it('LAST-ADMIN: blocks deactivating the sole remaining global admin', async () => {
      client.user.findUnique.mockResolvedValue({ id: 'sole-admin', keycloakSub: 'kc-sole-admin', roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
      client.userRole.findMany.mockResolvedValue([{ userId: 'sole-admin' }])

      await expect(service.deactivate(asClient(client), ADMIN, REALM, 'sole-admin')).rejects.toThrow(ConflictException)
      expect(keycloak.setEnabled).not.toHaveBeenCalled()
    })

    it('FIX 2(b): isAdmin routing is ROLE-BASED ONLY — a hypothetical unit-scoped ADMIN_KLIENTA row for the sole admin still takes the guarded (last-admin) branch', async () => {
      client.user.findUnique.mockResolvedValue({ id: 'sole-admin', keycloakSub: 'kc-sole-admin', roles: [{ role: Role.ADMIN_KLIENTA, unitId: 'unit-X' }] })
      client.userRole.findMany.mockResolvedValue([{ userId: 'sole-admin' }])

      await expect(service.deactivate(asClient(client), ADMIN, REALM, 'sole-admin')).rejects.toThrow(ConflictException)
      expect(keycloak.setEnabled).not.toHaveBeenCalled()
      expect(client.user.update).not.toHaveBeenCalled()
    })

    it('LAST-ADMIN TOCTOU: a concurrent write-skew detected by Postgres (P2034) is surfaced as a 409, not silently allowed', async () => {
      client.user.findUnique.mockResolvedValue({ id: 'admin-2', keycloakSub: 'kc-admin-2', roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
      client.userRole.findMany.mockResolvedValue([{ userId: 'admin-2' }, { userId: 'admin-3' }])
      client.$transaction.mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }))

      await expect(service.deactivate(asClient(client), ADMIN, REALM, 'admin-2')).rejects.toThrow(ConflictException)
    })

    it('403s a stale JWT whose real DB role was demoted from ADMIN_KLIENTA, even when deactivating SOMEONE ELSE', async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.HR, unitId: null }] })
      await expect(service.deactivate(asClient(client), ADMIN, REALM, 'target-1')).rejects.toThrow(ForbiddenException)
      expect(client.user.findUnique).not.toHaveBeenCalled()
      expect(keycloak.setEnabled).not.toHaveBeenCalled()
    })

    it('403s before any DB/KC call for a non-admin actor', async () => {
      await expect(service.deactivate(asClient(client), HR, REALM, 'target-1')).rejects.toThrow(ForbiddenException)
      expect(keycloak.setEnabled).not.toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('returns the RODO-safe roster ordered by createdAt desc', async () => {
      client.user.findMany.mockResolvedValue([])
      await service.list(asClient(client))
      expect(client.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          select: expect.objectContaining({ id: true, email: true, active: true, createdAt: true }),
        }),
      )
    })
  })

  describe('reconcile', () => {
    beforeEach(() => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.ADMIN_KLIENTA, unitId: null }] })
    })

    it('reports no findings when KC and DB agree for every user', async () => {
      client.user.findMany.mockResolvedValue([
        { id: 'user-1', keycloakSub: 'kc-1', roles: [{ role: Role.MANAGER }] },
      ])
      keycloak.getUserRealmRoles.mockResolvedValue(['MANAGER'])

      const result = await service.reconcile(asClient(client), ADMIN, REALM)

      expect(result).toEqual({ findings: [], fixedCount: 0 })
      expect(client.userRole.deleteMany).not.toHaveBeenCalled()
    })

    it("reports a 'db_only' finding for a UserRole row with no matching KC realm-role mapping (dangling GRANT/REVOKE step)", async () => {
      client.user.findMany.mockResolvedValue([
        { id: 'user-1', keycloakSub: 'kc-1', roles: [{ role: Role.MANAGER }] },
      ])
      keycloak.getUserRealmRoles.mockResolvedValue([])

      const result = await service.reconcile(asClient(client), ADMIN, REALM)

      expect(result.findings).toEqual([{ userId: 'user-1', role: Role.MANAGER, kind: 'db_only' }])
      expect(result.fixedCount).toBe(0)
      expect(client.userRole.deleteMany).not.toHaveBeenCalled()
    })

    it("reports a 'kc_only' finding for a KC realm-role mapping with no matching UserRole row, and NEVER auto-fixes it", async () => {
      client.user.findMany.mockResolvedValue([
        { id: 'user-1', keycloakSub: 'kc-1', roles: [] },
      ])
      keycloak.getUserRealmRoles.mockResolvedValue(['HR'])

      const result = await service.reconcile(asClient(client), ADMIN, REALM, { fix: true })

      expect(result.findings).toEqual([{ userId: 'user-1', role: Role.HR, kind: 'kc_only' }])
      expect(result.fixedCount).toBe(0)
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
      expect(keycloak.removeRealmRole).not.toHaveBeenCalled()
    })

    it("fix:true deletes the dangling UserRole row(s) for a 'db_only' finding — never calls Keycloak to re-grant", async () => {
      client.user.findMany.mockResolvedValue([
        { id: 'user-1', keycloakSub: 'kc-1', roles: [{ role: Role.MANAGER }] },
      ])
      keycloak.getUserRealmRoles.mockResolvedValue([])
      client.userRole.deleteMany.mockResolvedValue({ count: 1 })

      const result = await service.reconcile(asClient(client), ADMIN, REALM, { fix: true })

      expect(result.fixedCount).toBe(1)
      expect(client.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', role: Role.MANAGER } })
      expect(keycloak.assignRealmRole).not.toHaveBeenCalled()
    })

    it('ignores unknown KC role names (defense-in-depth against a foreign/legacy realm role)', async () => {
      client.user.findMany.mockResolvedValue([
        { id: 'user-1', keycloakSub: 'kc-1', roles: [] },
      ])
      keycloak.getUserRealmRoles.mockResolvedValue(['SOME_UNRELATED_CLIENT_ROLE'])

      const result = await service.reconcile(asClient(client), ADMIN, REALM)

      expect(result.findings).toEqual([])
    })

    it('is best-effort per user: a Keycloak read failure for one user is skipped, not fatal', async () => {
      client.user.findMany.mockResolvedValue([
        { id: 'user-1', keycloakSub: 'kc-1', roles: [{ role: Role.MANAGER }] },
        { id: 'user-2', keycloakSub: 'kc-2', roles: [{ role: Role.HR }] },
      ])
      keycloak.getUserRealmRoles.mockImplementation(async (_realm: string, kcId: string) => {
        if (kcId === 'kc-1') throw new Error('keycloak unreachable')
        return []
      })

      const result = await service.reconcile(asClient(client), ADMIN, REALM)

      expect(result.findings).toEqual([{ userId: 'user-2', role: Role.HR, kind: 'db_only' }])
    })

    it('scopes to a single user via opts.userId', async () => {
      client.user.findMany.mockResolvedValue([{ id: 'user-1', keycloakSub: 'kc-1', roles: [] }])
      keycloak.getUserRealmRoles.mockResolvedValue([])

      await service.reconcile(asClient(client), ADMIN, REALM, { userId: 'user-1' })

      expect(client.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }))
    })

    it('audits user.reconciled ids-only with counts, never PII', async () => {
      client.user.findMany.mockResolvedValue([{ id: 'user-1', keycloakSub: 'kc-1', roles: [{ role: Role.MANAGER }] }])
      keycloak.getUserRealmRoles.mockResolvedValue([])

      await service.reconcile(asClient(client), ADMIN, REALM, { fix: true })

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.reconciled', payload: { fix: true, findingsCount: 1, fixedCount: 1 } }),
      )
    })

    it('403s BEFORE any DB/KC read for a non-admin actor', async () => {
      await expect(service.reconcile(asClient(client), HR, REALM)).rejects.toThrow(ForbiddenException)
      expect(client.user.findMany).not.toHaveBeenCalled()
      expect(keycloak.getUserRealmRoles).not.toHaveBeenCalled()
    })

    it("403s a stale JWT whose real DB role was demoted from ADMIN_KLIENTA", async () => {
      client.user.findFirst.mockResolvedValue({ id: 'admin-db-id', active: true, roles: [{ role: Role.HR, unitId: null }] })
      await expect(service.reconcile(asClient(client), ADMIN, REALM)).rejects.toThrow(ForbiddenException)
      expect(client.user.findMany).not.toHaveBeenCalled()
    })
  })
})
