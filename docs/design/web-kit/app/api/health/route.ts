import { NextResponse } from 'next/server'

/** GET /api/health — liveness probe for load balancers and uptime monitors. */
export function GET() {
  return NextResponse.json({ ok: true, service: 'hrobot-web-kit' })
}
