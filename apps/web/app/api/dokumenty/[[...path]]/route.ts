// REAL proxy for every dokumenty endpoint: /api/dokumenty[/<x>] → ${TENANT_RUNTIME_URL}/dokumenty[/<x>].
// Covers list/mine, generuj, :id, :id/pobierz, :id/zatwierdz with one handler, so the browser client
// in lib/dokumenty.ts only ever hits same-origin routes. Mirrors app/api/strategic-brain/[[...path]],
// using an OPTIONAL catch-all so `/api/dokumenty` (no sub-path) also matches. See lib/tenant-runtime.ts.
//
// BINARY NOTE (SPEC §7): `:id/pobierz` streams a PDF/XML file, not JSON. `proxyToTenantRuntime` reads
// the upstream body as raw bytes (`.arrayBuffer()`, not `.text()`) and forwards `Content-Disposition`
// verbatim — see the comment on that function in lib/tenant-runtime.ts — so this same thin proxy
// handles the binary download correctly with no special-casing here. The web-kit UI (lib/dokumenty.ts
// `pobierzUrl` + the screen's download link) points a plain `<a href>` directly at this proxy path and
// lets the browser handle the byte stream / filename, rather than routing it through `dokFetch`'s JSON
// parsing — the simplest correct approach for a binary response.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('dokumenty', path ?? []), search)
}

export const GET = handle
export const POST = handle
