import { NextResponse } from 'next/server'
import {
  getEmployeeAccessSummary,
  updateAccess,
  type AccessModule,
  type AccessLevel,
} from '@/lib/dostepy'

const MODULES: AccessModule[] = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']
const LEVELS: AccessLevel[] = ['brak', 'podgląd', 'edycja', 'admin']

/** GET /api/dostepy/[employeeId] — get one employee's access summary */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await params
  const summary = getEmployeeAccessSummary(employeeId)
  if (!summary) {
    return NextResponse.json({ error: 'Employee access not found' }, { status: 404 })
  }
  return NextResponse.json(summary)
}

/** PUT /api/dostepy/[employeeId] — update all module access levels for employee */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await params

  // Verify employee exists
  const existing = getEmployeeAccessSummary(employeeId)
  if (!existing) {
    return NextResponse.json({ error: 'Employee access not found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const modules = body.modules as Record<string, unknown> | undefined
  const grantedBy = body.grantedBy ? String(body.grantedBy) : undefined

  if (!modules || typeof modules !== 'object') {
    return NextResponse.json({ error: 'modules is required' }, { status: 400 })
  }

  // Apply all module updates
  for (const mod of MODULES) {
    const level = modules[mod]
    if (level !== undefined && LEVELS.includes(level as AccessLevel)) {
      updateAccess(employeeId, mod, level as AccessLevel, grantedBy)
    }
  }

  const updated = getEmployeeAccessSummary(employeeId)!
  return NextResponse.json(updated)
}
