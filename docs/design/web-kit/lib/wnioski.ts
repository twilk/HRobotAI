// Mock leave-request data for the reference app.
//
// In the real app this comes from the authenticated tenant runtime.
// Seed data uses employee IDs/names from lib/employees.ts.

export type LeaveType =
  | 'urlop-wypoczynkowy'
  | 'urlop-chorobowy'
  | 'urlop-macierzynski'
  | 'urlop-ojcowski'
  | 'inne'

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface LeaveRequest {
  id: string
  employeeId: string
  employeeName: string
  type: LeaveType
  status: LeaveStatus
  dateFrom: string   // YYYY-MM-DD
  dateTo: string     // YYYY-MM-DD
  days: number
  reason?: string
  requestedAt: string  // ISO
  approvedBy?: string
  approvedAt?: string
  rejectionReason?: string
}

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  'urlop-wypoczynkowy': 'Urlop wypoczynkowy',
  'urlop-chorobowy': 'Urlop chorobowy',
  'urlop-macierzynski': 'Urlop macierzyński',
  'urlop-ojcowski': 'Urlop ojcowski',
  'inne': 'Inne',
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Oczekujący',
  approved: 'Zatwierdzony',
  rejected: 'Odrzucony',
  cancelled: 'Anulowany',
}

// Mutable in-memory store (resets on server restart / test module reload)
const LEAVE_REQUESTS: LeaveRequest[] = [
  {
    id: 'wr-1',
    employeeId: '1',
    employeeName: 'Anna Nowak',
    type: 'urlop-wypoczynkowy',
    status: 'approved',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-14',
    days: 10,
    reason: 'Urlop letni',
    requestedAt: '2026-06-01T08:30:00.000Z',
    approvedBy: 'Jan Kowalski',
    approvedAt: '2026-06-02T10:00:00.000Z',
  },
  {
    id: 'wr-2',
    employeeId: '2',
    employeeName: 'Piotr Wiśniewski',
    type: 'urlop-chorobowy',
    status: 'approved',
    dateFrom: '2026-05-20',
    dateTo: '2026-05-23',
    days: 4,
    requestedAt: '2026-05-20T07:00:00.000Z',
    approvedBy: 'Anna Nowak',
    approvedAt: '2026-05-20T08:00:00.000Z',
  },
  {
    id: 'wr-3',
    employeeId: '3',
    employeeName: 'Katarzyna Wójcik',
    type: 'urlop-wypoczynkowy',
    status: 'pending',
    dateFrom: '2026-08-04',
    dateTo: '2026-08-08',
    days: 5,
    reason: 'Wyjazd rodzinny',
    requestedAt: '2026-06-05T09:15:00.000Z',
  },
  {
    id: 'wr-4',
    employeeId: '4',
    employeeName: 'Tomasz Kamiński',
    type: 'inne',
    status: 'rejected',
    dateFrom: '2026-06-20',
    dateTo: '2026-06-20',
    days: 1,
    reason: 'Sprawy osobiste',
    requestedAt: '2026-06-03T11:00:00.000Z',
    rejectionReason: 'Zbyt mała obsada w tym terminie',
  },
  {
    id: 'wr-5',
    employeeId: '5',
    employeeName: 'Magdalena Lewandowska',
    type: 'urlop-macierzynski',
    status: 'approved',
    dateFrom: '2026-06-01',
    dateTo: '2026-11-28',
    days: 126,
    requestedAt: '2026-05-15T10:00:00.000Z',
    approvedBy: 'Jan Kowalski',
    approvedAt: '2026-05-15T14:00:00.000Z',
  },
  {
    id: 'wr-6',
    employeeId: '6',
    employeeName: 'Marek Zieliński',
    type: 'urlop-wypoczynkowy',
    status: 'pending',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-05',
    days: 5,
    requestedAt: '2026-06-07T13:45:00.000Z',
  },
  {
    id: 'wr-7',
    employeeId: '1',
    employeeName: 'Anna Nowak',
    type: 'urlop-ojcowski',
    status: 'cancelled',
    dateFrom: '2026-04-10',
    dateTo: '2026-04-11',
    days: 2,
    requestedAt: '2026-04-01T09:00:00.000Z',
  },
]

let nextId = LEAVE_REQUESTS.length + 1

/** List view: returns all requests, optionally filtered. */
export function getLeaveRequests(filters?: { status?: LeaveStatus; employeeId?: string }): LeaveRequest[] {
  let results = LEAVE_REQUESTS.slice()
  if (filters?.status) {
    results = results.filter((r) => r.status === filters.status)
  }
  if (filters?.employeeId) {
    results = results.filter((r) => r.employeeId === filters.employeeId)
  }
  return results
}

/** Detail view: returns one request or undefined. */
export function getLeaveRequest(id: string): LeaveRequest | undefined {
  return LEAVE_REQUESTS.find((r) => r.id === id)
}

/** Add a new leave request (status defaults to 'pending'). */
export function addLeaveRequest(
  data: Omit<LeaveRequest, 'id' | 'requestedAt' | 'status'>,
): LeaveRequest {
  const req: LeaveRequest = {
    ...data,
    id: `wr-${nextId++}`,
    status: 'pending',
    requestedAt: new Date().toISOString(),
  }
  LEAVE_REQUESTS.push(req)
  return req
}

/** Patch status fields on an existing request. Returns undefined if not found. */
export function updateLeaveRequest(
  id: string,
  patch: Partial<Pick<LeaveRequest, 'status' | 'approvedBy' | 'approvedAt' | 'rejectionReason'>>,
): LeaveRequest | undefined {
  const idx = LEAVE_REQUESTS.findIndex((r) => r.id === id)
  if (idx === -1) return undefined
  LEAVE_REQUESTS[idx] = { ...LEAVE_REQUESTS[idx], ...patch }
  return LEAVE_REQUESTS[idx]
}
