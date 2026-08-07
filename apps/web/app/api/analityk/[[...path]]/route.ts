// REAL proxy for every analityk endpoint: /api/analityk[/<x>] → ${TENANT_RUNTIME_URL}/analityk[/<x>].
// Covers podsumowanie (no sub-path), zatrudnienie, absencje, czas-pracy, urlopy, wnioski and
// porownanie with one handler, so the browser client in lib/analityk.ts only ever hits same-origin
// routes. Mirrors app/api/strategic-brain/[[...path]], using an OPTIONAL catch-all so `/api/analityk`
// (no sub-path) also matches. GET only — the module is read-only. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('analityk', path ?? []), search)
}

export const GET = handle
