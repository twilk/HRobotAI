import { NextResponse } from 'next/server'
import { markRead, getNotification } from '@/lib/notifications'

/** PATCH /api/notifications/[id] — body { read: true } */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  if (body.read === true) {
    const ok = markRead(id)
    if (!ok) {
      return NextResponse.json({ error: `Notification '${id}' not found` }, { status: 404 })
    }
    const updated = getNotification(id)
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Only { read: true } is supported' }, { status: 400 })
}
