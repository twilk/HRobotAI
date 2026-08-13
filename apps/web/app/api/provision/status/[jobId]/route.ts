import { NextResponse } from 'next/server'

const STEPS = ['CREATE_DB', 'RUN_MIGRATIONS', 'SEED', 'KEYCLOAK_SETUP', 'DONE'] as const

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const digits = jobId.replace(/\D/g, '')
  const start = digits ? Number(digits) : Date.now()
  const elapsed = Date.now() - start
  // Advance one step every 2.5s, capped at DONE.
  const idx = Math.min(STEPS.length - 1, Math.max(0, Math.floor(elapsed / 2500)))
  return NextResponse.json({ step: STEPS[idx], attemptCount: 0, error: null })
}
