import { NextResponse } from 'next/server'
import { getHRSummary } from '@/lib/raporty'

/** GET /api/raporty — return full HRSummary */
export function GET() {
  return NextResponse.json(getHRSummary())
}
