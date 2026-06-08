import { NextResponse } from 'next/server'
import { getEmployee, updateEmployee, setEmployeeStatus } from '@/lib/employees'

const VALID_STATUSES = ['active', 'inactive', 'on-leave', 'suspended', 'leave'] as const

/** GET /api/pracownicy/[id] — return single employee or 404 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const employee = getEmployee(id)
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }
  return NextResponse.json(employee)
}

/** PATCH /api/pracownicy/[id] — update profile fields and/or status */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // Validate status if present
  if (body.status !== undefined) {
    if (!(VALID_STATUSES as readonly string[]).includes(String(body.status))) {
      return NextResponse.json(
        { error: `Invalid status '${body.status}'. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }
  }

  // Check employee exists
  if (!getEmployee(id)) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }

  // Apply profile field updates
  const profileUpdates: Parameters<typeof updateEmployee>[1] = {}
  if (body.firstName !== undefined) profileUpdates.firstName = String(body.firstName)
  if (body.lastName !== undefined) profileUpdates.lastName = String(body.lastName)
  if (body.position !== undefined) profileUpdates.position = String(body.position)
  if (body.unit !== undefined) profileUpdates.unit = String(body.unit)
  if (body.email !== undefined) profileUpdates.email = String(body.email)
  if (body.phone !== undefined) profileUpdates.phone = String(body.phone)

  let updated = updateEmployee(id, profileUpdates)

  // Apply status update
  if (body.status !== undefined) {
    updated = setEmployeeStatus(id, body.status as 'active' | 'inactive' | 'on-leave' | 'suspended')
  }

  if (!updated) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }

  return NextResponse.json(updated)
}
