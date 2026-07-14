// REAL proxy for every Dostępy (access-grant) endpoint: /api/dostepy[/<x>] →
// ${TENANT_RUNTIME_URL}/dostepy[/<x>]. Covers the bare list/issue route AND the sub-routes
// (:id, :id/revoke) with one handler, so lib/dostepy.ts only ever hits same-origin routes. Mirrors
// app/api/wnioski/[[...path]] — uses an OPTIONAL catch-all so `/api/dostepy` (no sub-path,
// list+issue) also matches. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('dostepy', path ?? []), search)
}

export const GET = handle
export const POST = handle
