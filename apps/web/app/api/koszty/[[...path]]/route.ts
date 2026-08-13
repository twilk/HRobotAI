// REAL proxy for the SP4 cost surface: /api/koszty[/rates|/week] →
// ${TENANT_RUNTIME_URL}/koszty[/rates|/week]. Mirrors app/api/employees/[[...path]]/route.ts (optional
// catch-all so GET /api/koszty/rates, PATCH /api/koszty/rates, and GET /api/koszty/week?... all share
// one proxy). RBAC (rate/budget WRITES = HR/ADMIN_KLIENTA only, never MANAGER — Codex P1-1) and
// unitId-scoping for a MANAGER read are enforced entirely server-side by CostController/CostService;
// this proxy forwards method/query/body verbatim and passes the upstream status straight through
// (see lib/tenant-runtime.ts).

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('koszty', path ?? []), search)
}

export const GET = handle
export const PATCH = handle
