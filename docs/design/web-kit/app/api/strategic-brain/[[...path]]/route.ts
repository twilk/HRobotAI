// REAL proxy for every strategic-brain endpoint: /api/strategic-brain[/<x>] →
// ${TENANT_RUNTIME_URL}/strategic-brain[/<x>]. Covers overview, employee/me, employee/:id,
// recruitment, recruitment/:id/acknowledge, and config read/write with one handler, so the browser
// client in lib/strategic-brain.ts only ever hits same-origin routes. Mirrors
// app/api/ai-grafik/[[...path]], using an OPTIONAL catch-all so `/api/strategic-brain` (no
// sub-path) also matches. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('strategic-brain', path ?? []), search)
}

export const GET = handle
export const POST = handle
export const PATCH = handle
