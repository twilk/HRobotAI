// REAL proxy for every leave-request (Wnioski) endpoint: /api/wnioski[/<x>] →
// ${TENANT_RUNTIME_URL}/wnioski[/<x>]. Covers the bare list/create route AND the sub-routes
// (:id, :id/decision, :id/cancel) with one handler, so lib/wnioski.ts only ever hits same-origin
// routes. Mirrors app/api/shift-swap/[[...path]] — uses an OPTIONAL catch-all so `/api/wnioski`
// (no sub-path, list+create) also matches. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('wnioski', path ?? []), search)
}

export const GET = handle
export const POST = handle
