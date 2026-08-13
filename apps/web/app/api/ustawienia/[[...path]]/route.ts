// REAL proxy for company settings + org-unit CRUD: /api/ustawienia[/<path>] →
// ${TENANT_RUNTIME_URL}/ustawienia[/<path>]. Uses an OPTIONAL catch-all (mirrors
// app/api/employees/[[...path]] and app/api/ai-grafik/[[...path]]) so the bare `GET /api/ustawienia`
// (unused) plus `company`, `units`, and `units/:id` all share one proxy. RBAC is enforced entirely by
// the backend (UstawieniaController: MANAGER/HR/ADMIN_KLIENTA read, ADMIN_KLIENTA write) — this route
// forwards the method/body/bearer verbatim. See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('ustawienia', path ?? []), search)
}

export const GET = handle
export const POST = handle
export const PATCH = handle
