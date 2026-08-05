// REAL proxy for every AI-Grafik endpoint: /api/ai-grafik[/<x>] → ${TENANT_RUNTIME_URL}/ai-grafik[/<x>].
// Covers the config read/write (`GET`/`PATCH /ai-grafik/config`) and any future proposal routes with one
// handler, so the browser client in lib/ai-grafik.ts only ever hits same-origin routes. Mirrors
// app/api/shift-swap/[[...path]], using an OPTIONAL catch-all so `/api/ai-grafik` (no sub-path) also
// matches. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('ai-grafik', path ?? []), search)
}

export const GET = handle
export const POST = handle
export const PATCH = handle
