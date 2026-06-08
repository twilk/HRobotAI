import { NextResponse } from 'next/server'
import { getAllAccessSummaries } from '@/lib/dostepy'

/** GET /api/dostepy — return all employee access summaries */
export function GET() {
  return NextResponse.json(getAllAccessSummaries())
}
