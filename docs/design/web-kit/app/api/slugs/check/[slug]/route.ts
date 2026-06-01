import { NextResponse } from 'next/server'

// Demo: a few slugs are "taken". 'acme' is available so the happy path works.
const TAKEN = new Set(['test', 'demo', 'admin', 'hrobot', 'acme-corp'])

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return NextResponse.json({ available: !TAKEN.has(slug.toLowerCase()) })
}
