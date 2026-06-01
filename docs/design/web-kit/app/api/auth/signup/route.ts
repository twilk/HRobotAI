import { NextResponse } from 'next/server'

const TAKEN = new Set(['test', 'demo', 'admin', 'hrobot', 'acme-corp'])

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const slug = String(body.slug_normalized ?? body.slug ?? '').toLowerCase()

  if (TAKEN.has(slug)) {
    return NextResponse.json({ field: 'slug', message: 'Ta nazwa jest już zajęta' }, { status: 409 })
  }

  // jobId carries a timestamp; the status endpoint advances steps from it.
  return NextResponse.json({ jobId: `job-${Date.now()}` }, { status: 202 })
}
