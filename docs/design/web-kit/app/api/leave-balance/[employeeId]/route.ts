import { NextResponse } from 'next/server'
import { getLeaveBalance, deductLeave } from '@/lib/leave-balance'

type RouteContext = { params: Promise<{ employeeId: string }> }

/** GET /api/leave-balance/[employeeId] — return a single employee balance */
export async function GET(_req: Request, ctx: RouteContext) {
  const { employeeId } = await ctx.params
  const balance = getLeaveBalance(employeeId)
  if (!balance) {
    return NextResponse.json({ error: `Balance not found for employee '${employeeId}'` }, { status: 404 })
  }
  return NextResponse.json(balance)
}

/** PATCH /api/leave-balance/[employeeId] — deduct leave days */
export async function PATCH(req: Request, ctx: RouteContext) {
  const { employeeId } = await ctx.params

  // Ensure employee exists
  const existing = getLeaveBalance(employeeId)
  if (!existing) {
    return NextResponse.json({ error: `Balance not found for employee '${employeeId}'` }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leaveType = String(body.leaveType ?? '').trim() as 'urlop-wypoczynkowy' | 'urlop-ojcowski' | 'inne'
  const days = Number(body.days)

  if (!leaveType) {
    return NextResponse.json({ error: 'leaveType is required' }, { status: 400 })
  }
  if (!['urlop-wypoczynkowy', 'urlop-ojcowski', 'inne'].includes(leaveType)) {
    return NextResponse.json({ error: 'leaveType must be urlop-wypoczynkowy, urlop-ojcowski, or inne' }, { status: 400 })
  }
  if (!days || days < 1) {
    return NextResponse.json({ error: 'days must be a positive number' }, { status: 400 })
  }

  const success = deductLeave(employeeId, leaveType, days)
  if (!success) {
    return NextResponse.json({ error: 'Insufficient leave balance' }, { status: 400 })
  }

  const updated = getLeaveBalance(employeeId)
  return NextResponse.json(updated)
}
