// REAL proxy for every shift-swap endpoint: /api/shift-swap[/<x>] → ${TENANT_RUNTIME_URL}/shift-swap[/<x>].
// Covers the D2 state machine (create, submit, peer-decision, submit-to-manager, manager-decision,
// cancel) AND the bare polling list (`GET /shift-swap?state=&mine=`) with one handler, so the browser
// client in lib/swaps.ts only ever hits same-origin routes. Mirrors app/api/grafik/[...path], but uses
// an OPTIONAL catch-all so `/api/shift-swap` (no sub-path) also matches. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('shift-swap', path ?? []), search)
}

export const GET = handle
export const POST = handle
