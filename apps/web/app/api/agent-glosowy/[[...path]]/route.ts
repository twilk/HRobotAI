// REAL proxy for every agent-glosowy endpoint: /api/agent-glosowy[/<x>] →
// ${TENANT_RUNTIME_URL}/agent-glosowy[/<x>]. Covers interpret and execute with one handler, so the
// browser client in lib/agent-glosowy.ts only ever hits same-origin routes. Mirrors
// app/api/strategic-brain/[[...path]], using an OPTIONAL catch-all so `/api/agent-glosowy` (no
// sub-path) also matches. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('agent-glosowy', path ?? []), search)
}

export const GET = handle
export const POST = handle
