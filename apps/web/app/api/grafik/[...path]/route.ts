// REAL proxy for every grafik endpoint: /api/grafik/<x> → ${TENANT_RUNTIME_URL}/grafik/<x>.
// Covers A3 CRUD (shifts, shifts/:id, demands, templates) and A4 (solve) with one handler, so the
// browser client in lib/grafik.ts only ever hits same-origin routes. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('grafik', path), search)
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
