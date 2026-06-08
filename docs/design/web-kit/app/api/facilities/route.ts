import { NextResponse } from 'next/server'
import { getFacilities } from '@/lib/facilities'

/** GET /api/facilities — return all facilities */
export function GET() {
  return NextResponse.json(getFacilities())
}
