import type { TenantClient } from '@hrobot/db'
import { ShiftSwapService } from './shift-swap.service.js'
import {
  SwapState,
  IllegalSwapTransitionError,
  SwapNotFeasibleError,
  SwapRequestNotFoundError,
  SwapConcurrentModificationError,
} from './swap-state-machine.js'
import {
  AllowAllSwapFeasibilityValidator,
  type SwapFeasibilityValidator,
} from './swap-feasibility-validator.js'

const REQUESTER = 'emp-requester'
const TARGET = 'emp-target'
const REQ_SHIFT = 'shift-requester'
const TGT_SHIFT = 'shift-target'

type MockTx = {
  shift: { update: jest.Mock }
  shiftSwapRequest: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock }
  auditLog: { create: jest.Mock }
}

type MockClient = {
  shiftSwapRequest: { findUnique: jest.Mock; updateMany: jest.Mock; findUniqueOrThrow: jest.Mock }
  shift: { findUnique: jest.Mock; update: jest.Mock }
  $transaction: jest.Mock
  __tx: MockTx
}

/**
 * The service now writes via a state-guarded `updateMany` (optimistic lock, B4) and then reloads the
 * row with `findUniqueOrThrow`. The mock threads the last `updateMany` `data` through the reload so
 * result-state assertions keep working; each `updateMany` defaults to `{ count: 1 }` (matched).
 */
function makeClient(): MockClient {
  let txData: Record<string, unknown> = {}
  let topData: Record<string, unknown> = {}
  const tx: MockTx = {
    shift: { update: jest.fn().mockResolvedValue({}) },
    shiftSwapRequest: {
      updateMany: jest.fn().mockImplementation(({ data }) => {
        txData = data
        return { count: 1 }
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(() => ({ id: 'req-1', ...txData })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
  }
  return {
    shiftSwapRequest: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockImplementation(({ data }) => {
        topData = data
        return { count: 1 }
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(() => ({ id: 'req-1', ...topData })),
    },
    shift: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: MockTx) => unknown) => cb(tx)),
    __tx: tx,
  }
}

/** Build a request row in a given state; 1:1 swap by default (both target fields set). */
function makeRequest(state: SwapState, overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    requesterEmployeeId: REQUESTER,
    requesterShiftId: REQ_SHIFT,
    targetEmployeeId: TARGET,
    targetShiftId: TGT_SHIFT,
    state,
    reason: null,
    decidedByManagerId: null,
    createdAt: new Date('2026-07-09'),
    updatedAt: new Date('2026-07-09'),
    ...overrides,
  }
}

const as = (c: MockClient) => c as unknown as TenantClient

describe('ShiftSwapService', () => {
  let service: ShiftSwapService

  beforeEach(() => {
    service = new ShiftSwapService(new AllowAllSwapFeasibilityValidator())
  })

  describe('legal non-approve transitions', () => {
    it('submit: DRAFT → PENDING_PEER', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.DRAFT))
      const result = await service.submit(as(client), 'req-1')
      expect(client.shiftSwapRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', state: SwapState.DRAFT },
        data: { state: SwapState.PENDING_PEER },
      })
      expect(result.state).toBe(SwapState.PENDING_PEER)
    })

    it('peerDecision(accept): PENDING_PEER → PEER_AGREED', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.PENDING_PEER))
      await service.peerDecision(as(client), 'req-1', true)
      expect(client.shiftSwapRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', state: SwapState.PENDING_PEER },
        data: { state: SwapState.PEER_AGREED },
      })
    })

    it('submitToManager: PEER_AGREED → PENDING_MANAGER', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.PEER_AGREED))
      await service.submitToManager(as(client), 'req-1')
      expect(client.shiftSwapRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', state: SwapState.PEER_AGREED },
        data: { state: SwapState.PENDING_MANAGER },
      })
    })
  })

  describe('illegal transitions throw', () => {
    it('submit on an APPROVED request throws', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.APPROVED))
      await expect(service.submit(as(client), 'req-1')).rejects.toThrow(IllegalSwapTransitionError)
      expect(client.shiftSwapRequest.updateMany).not.toHaveBeenCalled()
    })

    it('submitToManager on a DRAFT request throws', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.DRAFT))
      await expect(service.submitToManager(as(client), 'req-1')).rejects.toThrow(
        IllegalSwapTransitionError,
      )
    })

    it('unknown id throws SwapRequestNotFoundError', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(null)
      await expect(service.submit(as(client), 'missing')).rejects.toThrow(SwapRequestNotFoundError)
    })
  })

  // SW4: reject/cancel at every stage leaves BOTH Shift rows untouched.
  describe('SW4 — reject/cancel never touch a Shift', () => {
    const NON_APPROVE_CASES: Array<{
      name: string
      state: SwapState
      run: (s: ShiftSwapService, c: TenantClient) => Promise<unknown>
      expectedState: SwapState
    }> = [
      {
        name: 'peer reject (PENDING_PEER → REJECTED)',
        state: SwapState.PENDING_PEER,
        run: (s, c) => s.peerDecision(c, 'req-1', false),
        expectedState: SwapState.REJECTED,
      },
      {
        name: 'manager reject (PENDING_MANAGER → REJECTED)',
        state: SwapState.PENDING_MANAGER,
        run: (s, c) => s.managerDecision(c, 'req-1', {
          approve: false,
          decidedByManagerId: 'mgr-1',
          actorUserId: 'user-mgr',
          ipAddress: '127.0.0.1',
        }),
        expectedState: SwapState.REJECTED,
      },
      {
        name: 'cancel from DRAFT',
        state: SwapState.DRAFT,
        run: (s, c) => s.cancel(c, 'req-1'),
        expectedState: SwapState.CANCELLED,
      },
      {
        name: 'cancel from PENDING_PEER',
        state: SwapState.PENDING_PEER,
        run: (s, c) => s.cancel(c, 'req-1'),
        expectedState: SwapState.CANCELLED,
      },
      {
        name: 'cancel from PEER_AGREED',
        state: SwapState.PEER_AGREED,
        run: (s, c) => s.cancel(c, 'req-1'),
        expectedState: SwapState.CANCELLED,
      },
      {
        name: 'cancel from PENDING_MANAGER',
        state: SwapState.PENDING_MANAGER,
        run: (s, c) => s.cancel(c, 'req-1'),
        expectedState: SwapState.CANCELLED,
      },
    ]

    it.each(NON_APPROVE_CASES)('$name leaves both shifts untouched', async ({ state, run, expectedState }) => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(state))

      await run(service, as(client))

      // No shift mutated, on either the top-level client or inside a transaction.
      expect(client.shift.update).not.toHaveBeenCalled()
      expect(client.__tx.shift.update).not.toHaveBeenCalled()
      expect(client.$transaction).not.toHaveBeenCalled()
      // The request itself transitions to the expected terminal state (state-guarded updateMany).
      const call = client.shiftSwapRequest.updateMany.mock.calls[0][0]
      expect(call.data.state).toBe(expectedState)
    })

    it('manager reject records decidedByManagerId', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.PENDING_MANAGER))
      await service.managerDecision(as(client), 'req-1', {
        approve: false,
        decidedByManagerId: 'mgr-7',
        actorUserId: 'user-mgr',
        ipAddress: '10.0.0.1',
      })
      expect(client.shiftSwapRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', state: SwapState.PENDING_MANAGER },
        data: { state: SwapState.REJECTED, decidedByManagerId: 'mgr-7' },
      })
    })
  })

  // SW1 (D1 slice): APPROVED atomically swaps both shifts + writes an AuditLog row, all in one tx.
  describe('APPROVED happy path — atomic swap + audit', () => {
    it('swaps both shifts, updates state, and writes an audit row inside a single transaction', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.PENDING_MANAGER))
      client.shift.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === REQ_SHIFT
          ? { id: REQ_SHIFT, employeeId: REQUESTER }
          : { id: TGT_SHIFT, employeeId: TARGET },
      )

      const result = await service.managerDecision(as(client), 'req-1', {
        approve: true,
        decidedByManagerId: 'mgr-1',
        actorUserId: 'user-mgr',
        ipAddress: '127.0.0.1',
      })

      // Atomicity: everything went through $transaction, nothing on the top-level client.
      expect(client.$transaction).toHaveBeenCalledTimes(1)
      expect(client.shift.update).not.toHaveBeenCalled()

      const tx = client.__tx
      // Requester's shift → target employee; target's shift → requester employee (1:1 swap).
      expect(tx.shift.update).toHaveBeenCalledWith({
        where: { id: REQ_SHIFT },
        data: { employeeId: TARGET },
      })
      expect(tx.shift.update).toHaveBeenCalledWith({
        where: { id: TGT_SHIFT },
        data: { employeeId: REQUESTER },
      })
      expect(tx.shift.update).toHaveBeenCalledTimes(2)

      // Request transitions to APPROVED with the deciding manager recorded (state-guarded updateMany).
      expect(tx.shiftSwapRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', state: SwapState.PENDING_MANAGER },
        data: { state: SwapState.APPROVED, decidedByManagerId: 'mgr-1' },
      })

      // Audit row written in the same transaction.
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1)
      const audit = tx.auditLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({
        actorUserId: 'user-mgr',
        action: 'shift_swap.approved',
        entityType: 'ShiftSwapRequest',
        entityId: 'req-1',
        ipAddress: '127.0.0.1',
      })
      expect(result.state).toBe(SwapState.APPROVED)
    })

    it('give-away (no target shift) reassigns only the requester shift', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(
        makeRequest(SwapState.PENDING_MANAGER, { targetShiftId: null }),
      )
      client.shift.findUnique.mockResolvedValue({ id: REQ_SHIFT, employeeId: REQUESTER })

      await service.managerDecision(as(client), 'req-1', {
        approve: true,
        decidedByManagerId: 'mgr-1',
        actorUserId: 'user-mgr',
        ipAddress: '127.0.0.1',
      })

      const tx = client.__tx
      expect(tx.shift.update).toHaveBeenCalledTimes(1)
      expect(tx.shift.update).toHaveBeenCalledWith({
        where: { id: REQ_SHIFT },
        data: { employeeId: TARGET },
      })
    })
  })

  // SW2 seam (mechanism only — the real solver check is D2): an infeasible verdict blocks the swap.
  describe('feasibility validator seam', () => {
    it('an infeasible verdict throws and leaves both shifts untouched (no transaction)', async () => {
      const rejecting: SwapFeasibilityValidator = {
        validate: async () => ({ feasible: false, reason: 'H2 rest window violated' }),
      }
      const s = new ShiftSwapService(rejecting)
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.PENDING_MANAGER))
      client.shift.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === REQ_SHIFT
          ? { id: REQ_SHIFT, employeeId: REQUESTER }
          : { id: TGT_SHIFT, employeeId: TARGET },
      )

      await expect(
        s.managerDecision(as(client), 'req-1', {
          approve: true,
          decidedByManagerId: 'mgr-1',
          actorUserId: 'user-mgr',
          ipAddress: '127.0.0.1',
        }),
      ).rejects.toThrow(SwapNotFeasibleError)

      expect(client.$transaction).not.toHaveBeenCalled()
      expect(client.shift.update).not.toHaveBeenCalled()
      expect(client.__tx.shift.update).not.toHaveBeenCalled()
    })
  })

  // B4: optimistic lock — a state-guarded updateMany matching zero rows means the request moved out
  // from under us (concurrent cancel/reject/approve), so we abort and roll back instead of clobbering.
  describe('B4 — concurrent-modification guard (optimistic lock)', () => {
    it('approve aborts with SwapConcurrentModificationError and writes no audit when the row left PENDING_MANAGER', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.PENDING_MANAGER))
      client.shift.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === REQ_SHIFT
          ? { id: REQ_SHIFT, employeeId: REQUESTER }
          : { id: TGT_SHIFT, employeeId: TARGET },
      )
      // A concurrent transition already moved the row: the guarded update inside the tx matches nothing.
      client.__tx.shiftSwapRequest.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.managerDecision(as(client), 'req-1', {
          approve: true,
          decidedByManagerId: 'mgr-1',
          actorUserId: 'user-mgr',
          ipAddress: '127.0.0.1',
        }),
      ).rejects.toBeInstanceOf(SwapConcurrentModificationError)

      // The throw aborts the transaction: no audit row and no reload of a (would-be) updated request.
      expect(client.__tx.auditLog.create).not.toHaveBeenCalled()
      expect(client.__tx.shiftSwapRequest.findUniqueOrThrow).not.toHaveBeenCalled()
    })

    it('a non-approve transition aborts with SwapConcurrentModificationError when the state moved concurrently', async () => {
      const client = makeClient()
      client.shiftSwapRequest.findUnique.mockResolvedValue(makeRequest(SwapState.DRAFT))
      client.shiftSwapRequest.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.submit(as(client), 'req-1')).rejects.toBeInstanceOf(
        SwapConcurrentModificationError,
      )
      // We never reload/return a stale row when the guarded update matched nothing.
      expect(client.shiftSwapRequest.findUniqueOrThrow).not.toHaveBeenCalled()
    })
  })
})
