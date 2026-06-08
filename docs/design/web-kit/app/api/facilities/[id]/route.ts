import { NextResponse } from 'next/server'
import { getFacility, setFacilityHours, setFacilityAddress, type WeeklyHours, type Address } from '@/lib/facilities'

/** GET /api/facilities/[id] — get one facility */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const facility = getFacility(id)
  if (!facility) {
    return NextResponse.json({ error: 'Facility not found' }, { status: 404 })
  }
  return NextResponse.json(facility)
}

/** PATCH /api/facilities/[id] — update address and/or hours */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const existing = getFacility(id)
  if (!existing) {
    return NextResponse.json({ error: 'Facility not found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    address?: Partial<Address>
    hours?: WeeklyHours
  }

  let current = existing

  if (body.address && typeof body.address === 'object') {
    const updated = setFacilityAddress(id, body.address)
    if (updated) current = updated
  }

  if (body.hours && Array.isArray(body.hours) && body.hours.length === 7) {
    const updated = setFacilityHours(id, body.hours as WeeklyHours)
    if (updated) current = updated
  }

  // Re-fetch to ensure we return the latest store state
  return NextResponse.json(getFacility(id) ?? current)
}
