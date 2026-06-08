import { NextResponse } from 'next/server'
import { getShifts, addShift } from '@/lib/schedule'

/** GET /api/grafik/shifts — return shifts, optionally filtered by facilityId and/or weekStart */
export function GET(req: Request) {
  const url = new URL(req.url)
  const facilityId = url.searchParams.get('facilityId') ?? undefined
  const weekStart = url.searchParams.get('weekStart') ?? undefined
  return NextResponse.json(getShifts(facilityId, weekStart))
}

/** POST /api/grafik/shifts — add a new shift */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { employeeId, facilityId, date, timeFrom, timeTo, role } = body as {
    employeeId?: string
    facilityId?: string
    date?: string
    timeFrom?: string
    timeTo?: string
    role?: string
  }

  if (!employeeId || !facilityId || !date || !timeFrom || !timeTo) {
    return NextResponse.json(
      { error: 'employeeId, facilityId, date, timeFrom, and timeTo are required' },
      { status: 400 },
    )
  }

  const input: Omit<import('@/lib/schedule').Shift, 'id'> = {
    employeeId,
    facilityId,
    date,
    start: timeFrom,
    end: timeTo,
  }
  if (role !== undefined) input.role = role
  const shift = addShift(input)

  return NextResponse.json(shift, { status: 201 })
}
