import { NextResponse } from 'next/server'
import { getAllLeaveBalances } from '@/lib/leave-balance'

/** GET /api/leave-balance?year=2026 — return all balances for a year */
export function GET(req: Request) {
  const url = new URL(req.url)
  const yearParam = url.searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : undefined

  const balances = getAllLeaveBalances(year)
  return NextResponse.json(balances)
}
