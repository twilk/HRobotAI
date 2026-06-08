import { NextResponse } from 'next/server'
import { removeShift, updateShift, type Shift } from '@/lib/schedule'

/** DELETE /api/grafik/shifts/[id] — remove a shift */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const removed = removeShift(id)
  if (!removed) {
    return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

/** PATCH /api/grafik/shifts/[id] — partial update of a shift */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Partial<Omit<Shift, 'id'>>
  const updated = updateShift(id, body)
  if (!updated) {
    return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
  }
  return NextResponse.json(updated)
}
