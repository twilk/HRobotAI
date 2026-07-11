import { ConflictException, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { TenantClient } from '@hrobot/db'
import { Role } from '@hrobot/shared'
import { ShiftSwapController } from './shift-swap.controller.js'
import { ShiftSwapService } from './shift-swap.service.js'
import { AllowAllSwapFeasibilityValidator } from './swap-feasibility-validator.js'
import {
  SwapState,
  SwapRequestNotFoundError,
  SwapConcurrentModificationError,
} from './swap-state-machine.js'
import { ROLES_KEY } from '../tenant-runtime/rbac/roles.decorator.js'
import type { JwtPayload } from '../tenant-runtime/keycloak/keycloak-jwt.strategy.js'

/**
 * SW1/SW3/SW4 at the ENDPOINT path: a real {@link ShiftSwapController} → real {@link ShiftSwapService}
 * → an in-memory tenant client, so the controller's RBAC `assert*` calls + the D1 state machine +
 * atomic approve-swap all run. Feasibility uses the allow-all validator here; the real validator's
 * INFEASIBLE path is covered in `optimizer-swap-feasibility.validator.spec.ts` (SW2).
 *
 * Synthetic data only (RODO): no PESEL, no real names.
 */

interface Shift {
  id: string
  employeeId: string
  lokalizacjaId: string
  date: Date
  start: string
  end: string
  role: string
}
interface SwapRow {
  id: string
  requesterEmployeeId: string
  requesterShiftId: string
  targetEmployeeId: string | null
  targetShiftId: string | null
  state: string
  reason: string | null
  decidedByManagerId: string | null
  createdAt: Date
  updatedAt: Date
}
interface Store {
  employees: Array<{ id: string; unitId: string; keycloakSub: string; qualifications: string[]; etat: number }>
  userRoles: Array<{ keycloakSub: string; role: string; unitId: string | null }>
  shifts: Shift[]
  swaps: SwapRow[]
  audits: Array<Record<string, unknown>>
  seq: number
}

function newStore(): Store {
  return { employees: [], userRoles: [], shifts: [], swaps: [], audits: [], seq: 0 }
}

/** An in-memory TenantClient implementing exactly the operations the swap service touches. */
function makeClient(store: Store): TenantClient {
  const empByKc = (kc: string) => store.employees.find((e) => e.keycloakSub === kc)
  const client = {
    employee: {
      findFirst: async ({ where }: { where: { user: { keycloakSub: string } } }) => {
        const e = empByKc(where.user.keycloakSub)
        return e ? { id: e.id, unitId: e.unitId } : null
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const e = store.employees.find((x) => x.id === where.id)
        return e ? { id: e.id, unitId: e.unitId, qualifications: e.qualifications, etat: e.etat } : null
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        store.employees.filter((e) => where.id.in.includes(e.id)).map((e) => ({ unitId: e.unitId })),
    },
    userRole: {
      findMany: async ({ where }: { where: { user: { keycloakSub: string }; role: string } }) =>
        store.userRoles
          .filter((r) => r.keycloakSub === where.user.keycloakSub && r.role === where.role && r.unitId !== null)
          .map((r) => ({ unitId: r.unitId })),
    },
    shift: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.shifts.find((s) => s.id === where.id) ?? null,
      findMany: async () => [],
      update: async ({ where, data }: { where: { id: string }; data: { employeeId: string } }) => {
        const s = store.shifts.find((x) => x.id === where.id)!
        s.employeeId = data.employeeId
        return s
      },
    },
    shiftSwapRequest: {
      create: async ({ data }: { data: Partial<SwapRow> }) => {
        const row: SwapRow = {
          id: `req-${++store.seq}`,
          requesterEmployeeId: data.requesterEmployeeId!,
          requesterShiftId: data.requesterShiftId!,
          targetEmployeeId: data.targetEmployeeId ?? null,
          targetShiftId: data.targetShiftId ?? null,
          state: data.state ?? SwapState.DRAFT,
          reason: null,
          decidedByManagerId: null,
          createdAt: new Date('2026-07-09'),
          updatedAt: new Date('2026-07-09'),
        }
        store.swaps.push(row)
        return row
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.swaps.find((s) => s.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = store.swaps.find((s) => s.id === where.id)
        if (!row) throw new Error(`ShiftSwapRequest not found: ${where.id}`)
        return row
      },
      // State-guarded optimistic-lock write (B4): only match when the current state equals where.state.
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; state?: string }
        data: Partial<SwapRow>
      }) => {
        const row = store.swaps.find(
          (s) => s.id === where.id && (where.state === undefined || s.state === where.state),
        )
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<SwapRow> }) => {
        const row = store.swaps.find((s) => s.id === where.id)!
        Object.assign(row, data)
        return row
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const unitOf = (empId: string | null) => store.employees.find((e) => e.id === empId)?.unitId
        const matchCond = (row: SwapRow, c: Record<string, unknown>): boolean => {
          if ('requesterEmployeeId' in c) return row.requesterEmployeeId === c.requesterEmployeeId
          if ('targetEmployeeId' in c) return row.targetEmployeeId === c.targetEmployeeId
          if ('requester' in c) {
            const inList = (c.requester as { unitId: { in: string[] } }).unitId.in
            return inList.includes(unitOf(row.requesterEmployeeId) ?? '')
          }
          if ('target' in c) {
            const inList = (c.target as { unitId: { in: string[] } }).unitId.in
            return inList.includes(unitOf(row.targetEmployeeId) ?? '')
          }
          return false
        }
        return store.swaps.filter((row) => {
          if (where.state && row.state !== where.state) return false
          if (where.OR) return (where.OR as Array<Record<string, unknown>>).some((c) => matchCond(row, c))
          return true
        })
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.audits.push(data)
        return { id: `audit-${store.audits.length}` }
      },
    },
    $transaction: async (cb: (tx: TenantClient) => unknown) => cb(client as unknown as TenantClient),
  }
  return client as unknown as TenantClient
}

const jwt = (sub: string, roles: string[]): JwtPayload => ({ sub, iss: 'x', hrobot_roles: roles, exp: 0 })

/** A tenant seeded with two workers in unit U1 + a manager of U1. */
function seedTenant() {
  const store = newStore()
  store.employees.push(
    { id: 'emp-A', unitId: 'U1', keycloakSub: 'kc-A', qualifications: ['NURSE'], etat: 1 },
    { id: 'emp-B', unitId: 'U1', keycloakSub: 'kc-B', qualifications: ['NURSE'], etat: 1 },
  )
  store.userRoles.push({ keycloakSub: 'kc-M', role: Role.MANAGER, unitId: 'U1' })
  store.shifts.push(
    { id: 'SA', employeeId: 'emp-A', lokalizacjaId: 'loc-1', date: new Date('2026-07-13'), start: '08:00', end: '16:00', role: 'NURSE' },
    { id: 'SB', employeeId: 'emp-B', lokalizacjaId: 'loc-1', date: new Date('2026-07-14'), start: '08:00', end: '16:00', role: 'NURSE' },
  )
  return { store, client: makeClient(store) }
}

function makeController(): ShiftSwapController {
  const service = new ShiftSwapService(new AllowAllSwapFeasibilityValidator())
  return new ShiftSwapController(service)
}

const WORKER_A = jwt('kc-A', [Role.PRACOWNIK])
const WORKER_B = jwt('kc-B', [Role.PRACOWNIK])
const MANAGER = jwt('kc-M', [Role.MANAGER])

describe('ShiftSwapController — endpoint paths', () => {
  // SW1: create → submit → peer accept → submit-to-manager → manager approve.
  describe('SW1 — full happy path', () => {
    it('swaps both shifts and writes an audit row on manager approval', async () => {
      const { store, client } = seedTenant()
      const ctl = makeController()

      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      expect(created.state).toBe(SwapState.DRAFT)
      expect(created.requesterEmployeeId).toBe('emp-A')
      expect(created.targetEmployeeId).toBe('emp-B')

      expect((await ctl.submit(client, WORKER_A, created.id) as SwapRow).state).toBe(SwapState.PENDING_PEER)
      expect((await ctl.peerDecision(client, WORKER_B, created.id, { accept: true }) as SwapRow).state).toBe(SwapState.PEER_AGREED)
      expect((await ctl.submitToManager(client, WORKER_A, created.id) as SwapRow).state).toBe(SwapState.PENDING_MANAGER)

      const approved = (await ctl.managerDecision(client, MANAGER, '9.9.9.9', created.id, { approve: true })) as SwapRow
      expect(approved.state).toBe(SwapState.APPROVED)

      // Both shifts' employeeId swapped.
      expect(store.shifts.find((s) => s.id === 'SA')!.employeeId).toBe('emp-B')
      expect(store.shifts.find((s) => s.id === 'SB')!.employeeId).toBe('emp-A')
      // Audit row written for the approval.
      expect(store.audits).toHaveLength(1)
      expect(store.audits[0]).toMatchObject({ action: 'shift_swap.approved', entityType: 'ShiftSwapRequest' })
    })
  })

  // SW3: RBAC — non-target peer, non-manager decision, cross-tenant isolation.
  describe('SW3 — RBAC + tenant isolation', () => {
    it('a worker cannot open a swap for a shift they do not own', async () => {
      const { client } = seedTenant()
      const ctl = makeController()
      // SA belongs to emp-A; WORKER_B must not be able to swap it away.
      await expect(ctl.create(client, WORKER_B, { requesterShiftId: 'SA', targetShiftId: 'SB' })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('a non-target worker cannot peer-decide', async () => {
      const { client } = seedTenant()
      const ctl = makeController()
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      await ctl.submit(client, WORKER_A, created.id)
      // WORKER_A is the requester, NOT the target → forbidden.
      await expect(ctl.peerDecision(client, WORKER_A, created.id, { accept: true })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('a non-manager (worker) cannot manager-decide', async () => {
      const { client } = seedTenant()
      const ctl = makeController()
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      await expect(ctl.managerDecision(client, WORKER_A, '1.1.1.1', created.id, { approve: true })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('a MANAGER of a different unit cannot manager-decide', async () => {
      const { store, client } = seedTenant()
      store.userRoles.push({ keycloakSub: 'kc-M2', role: Role.MANAGER, unitId: 'U2' })
      const ctl = makeController()
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      const otherMgr = jwt('kc-M2', [Role.MANAGER])
      await expect(ctl.managerDecision(client, otherMgr, '1.1.1.1', created.id, { approve: true })).rejects.toBeInstanceOf(ForbiddenException)
    })

    // B3: a manager who manages only ONE affected unit may NOT decide a cross-unit swap — approving
    // would mutate a shift/employee in the unit they do not manage. Requires EVERY affected unit.
    it('a MANAGER of only one side cannot decide a cross-unit swap', async () => {
      const { store, client } = seedTenant()
      // A second worker in a DIFFERENT unit (U2), holding their own shift.
      store.employees.push({ id: 'emp-C', unitId: 'U2', keycloakSub: 'kc-C', qualifications: ['NURSE'], etat: 1 })
      store.shifts.push({ id: 'SC', employeeId: 'emp-C', lokalizacjaId: 'loc-2', date: new Date('2026-07-15'), start: '08:00', end: '16:00', role: 'NURSE' })
      const ctl = makeController()

      // Requester emp-A (U1) ↔ target emp-C (U2). MANAGER manages U1 only.
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SC' })) as SwapRow
      expect(created.targetEmployeeId).toBe('emp-C')
      await expect(
        ctl.managerDecision(client, MANAGER, '1.1.1.1', created.id, { approve: true }),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('cross-tenant: a request from tenant A is invisible to tenant B’s client', async () => {
      const a = seedTenant()
      const b = seedTenant()
      const ctl = makeController()
      const created = (await ctl.create(a.client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      // Same id, different tenant client → not found (isolation via per-request client).
      await expect(ctl.submit(b.client, WORKER_A, created.id)).rejects.toBeInstanceOf(SwapRequestNotFoundError)
      expect(b.store.swaps).toHaveLength(0)
    })
  })

  // SW4: reject/cancel at any stage leaves both Shift rows untouched.
  describe('SW4 — reject/cancel never mutate a Shift', () => {
    it('peer reject → REJECTED, shifts untouched', async () => {
      const { store, client } = seedTenant()
      const ctl = makeController()
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      await ctl.submit(client, WORKER_A, created.id)
      const rejected = (await ctl.peerDecision(client, WORKER_B, created.id, { accept: false })) as SwapRow
      expect(rejected.state).toBe(SwapState.REJECTED)
      expect(store.shifts.find((s) => s.id === 'SA')!.employeeId).toBe('emp-A')
      expect(store.shifts.find((s) => s.id === 'SB')!.employeeId).toBe('emp-B')
      expect(store.audits).toHaveLength(0)
    })

    it('manager reject → REJECTED, shifts untouched', async () => {
      const { store, client } = seedTenant()
      const ctl = makeController()
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      await ctl.submit(client, WORKER_A, created.id)
      await ctl.peerDecision(client, WORKER_B, created.id, { accept: true })
      await ctl.submitToManager(client, WORKER_A, created.id)
      const rejected = (await ctl.managerDecision(client, MANAGER, '1.1.1.1', created.id, { approve: false })) as SwapRow
      expect(rejected.state).toBe(SwapState.REJECTED)
      expect(store.shifts.find((s) => s.id === 'SA')!.employeeId).toBe('emp-A')
      expect(store.shifts.find((s) => s.id === 'SB')!.employeeId).toBe('emp-B')
    })

    it('requester cancel at PENDING_MANAGER → CANCELLED, shifts untouched', async () => {
      const { store, client } = seedTenant()
      const ctl = makeController()
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      await ctl.submit(client, WORKER_A, created.id)
      await ctl.peerDecision(client, WORKER_B, created.id, { accept: true })
      await ctl.submitToManager(client, WORKER_A, created.id)
      const cancelled = (await ctl.cancel(client, WORKER_A, created.id)) as SwapRow
      expect(cancelled.state).toBe(SwapState.CANCELLED)
      expect(store.shifts.find((s) => s.id === 'SA')!.employeeId).toBe('emp-A')
      expect(store.shifts.find((s) => s.id === 'SB')!.employeeId).toBe('emp-B')
    })
  })

  // GET list scoping: a worker sees their own; a manager sees their unit.
  describe('GET /shift-swap list scoping', () => {
    it('mine=true returns only the caller’s own requests', async () => {
      const { client } = seedTenant()
      const ctl = makeController()
      await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })
      const mineA = (await ctl.list(client, WORKER_A, { mine: true })) as SwapRow[]
      expect(mineA).toHaveLength(1)
      // A worker with no swaps + mine=true sees none.
      const other = jwt('kc-C', [Role.PRACOWNIK])
      expect((await ctl.list(client, other, { mine: true })) as SwapRow[]).toHaveLength(0)
    })

    it('a manager sees requests in their unit; state filter narrows', async () => {
      const { client } = seedTenant()
      const ctl = makeController()
      const created = (await ctl.create(client, WORKER_A, { requesterShiftId: 'SA', targetShiftId: 'SB' })) as SwapRow
      const asManager = (await ctl.list(client, MANAGER, {})) as SwapRow[]
      expect(asManager.map((r) => r.id)).toContain(created.id)
      expect((await ctl.list(client, MANAGER, { state: SwapState.APPROVED })) as SwapRow[]).toHaveLength(0)
    })
  })

  // RBAC coarse gate: @Roles metadata wired to the manager-decision route.
  describe('@Roles gate metadata', () => {
    const reflector = new Reflector()
    const rolesFor = (m: keyof ShiftSwapController): string[] =>
      reflector.get<string[]>(ROLES_KEY, ShiftSwapController.prototype[m] as (...a: unknown[]) => unknown) ?? []

    it('manager-decision is gated to MANAGER/HR/ADMIN (worker excluded)', () => {
      expect(rolesFor('managerDecision')).toEqual([Role.MANAGER, Role.HR, Role.ADMIN_KLIENTA])
      expect(rolesFor('managerDecision')).not.toContain(Role.PRACOWNIK)
    })

    it('create/submit/peer-decision allow any authenticated role', () => {
      for (const m of ['create', 'submit', 'peerDecision', 'list'] as const) {
        expect(rolesFor(m)).toContain(Role.PRACOWNIK)
      }
    })
  })

  // B4: the service's optimistic-lock signal must reach the client as HTTP 409 Conflict, not a 500.
  describe('B4 — concurrent modification maps to HTTP 409', () => {
    it('managerDecision surfaces SwapConcurrentModificationError as ConflictException', async () => {
      const service = {
        assertManager: jest.fn().mockResolvedValue({ id: 'req-1' }),
        managerDecision: jest.fn().mockRejectedValue(new SwapConcurrentModificationError('req-1')),
      } as unknown as ShiftSwapService
      const ctl = new ShiftSwapController(service)

      await expect(
        ctl.managerDecision({} as unknown as TenantClient, MANAGER, '1.1.1.1', 'req-1', { approve: true }),
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('a non-approve transition (cancel) also maps the conflict to ConflictException', async () => {
      const service = {
        assertRequester: jest.fn().mockResolvedValue({ id: 'req-1' }),
        cancel: jest.fn().mockRejectedValue(new SwapConcurrentModificationError('req-1')),
      } as unknown as ShiftSwapService
      const ctl = new ShiftSwapController(service)

      await expect(
        ctl.cancel({} as unknown as TenantClient, WORKER_A, 'req-1'),
      ).rejects.toBeInstanceOf(ConflictException)
    })
  })
})
