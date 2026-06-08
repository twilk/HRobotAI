import { NextResponse } from 'next/server'
import { updateLeaveRequest, type LeaveStatus } from '@/lib/wnioski'

/** PATCH /api/wnioski/[id] — update status (approve / reject / cancel) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const patch: {
    status?: LeaveStatus
    approvedBy?: string
    approvedAt?: string
    rejectionReason?: string
  } = {}

  if (body.status) patch.status = body.status as LeaveStatus
  if (body.approvedBy) patch.approvedBy = String(body.approvedBy)
  if (body.approvedAt) patch.approvedAt = String(body.approvedAt)
  if (body.rejectionReason) patch.rejectionReason = String(body.rejectionReason)

  const updated = updateLeaveRequest(id, patch)
  if (!updated) {
    return NextResponse.json({ error: 'Leave request not found' }, { status: 404 })
  }

  return NextResponse.json(updated)
}
