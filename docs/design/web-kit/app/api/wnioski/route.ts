import { NextResponse } from 'next/server'
import { getLeaveRequests, addLeaveRequest, type LeaveType, type LeaveStatus } from '@/lib/wnioski'

/** GET /api/wnioski?status=pending&employeeId=1 — return filtered list */
export function GET(req: Request) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') as LeaveStatus | null
  const employeeId = url.searchParams.get('employeeId') ?? undefined

  const requests = getLeaveRequests({
    ...(status ? { status } : {}),
    ...(employeeId ? { employeeId } : {}),
  })

  return NextResponse.json(requests)
}

/** POST /api/wnioski — create a new leave request */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const employeeId = String(body.employeeId ?? '').trim()
  const employeeName = String(body.employeeName ?? '').trim()
  const type = String(body.type ?? '').trim() as LeaveType
  const dateFrom = String(body.dateFrom ?? '').trim()
  const dateTo = String(body.dateTo ?? '').trim()
  const days = Number(body.days)
  const reason = body.reason ? String(body.reason).trim() : undefined

  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
  }
  if (!type) {
    return NextResponse.json({ error: 'type is required' }, { status: 400 })
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 })
  }
  if (!days || days < 1) {
    return NextResponse.json({ error: 'days must be a positive number' }, { status: 400 })
  }

  const created = addLeaveRequest({ employeeId, employeeName, type, dateFrom, dateTo, days, reason })
  return NextResponse.json(created, { status: 201 })
}
