// REAL proxy for the employee roster + single-profile endpoints: /api/employees[/<id>] →
// ${TENANT_RUNTIME_URL}/employees[/<id>]. Uses an OPTIONAL catch-all (mirrors
// app/api/shift-swap/[[...path]]) so the bare roster route (`GET /api/employees`, unchanged since
// Task 2a) and the new `GET /api/employees/:id` single-employee profile route (Task 2b) share one
// proxy. The grafik grid needs employee names to label rows/chips (the API returns UUIDs on shifts).
// PESEL/email are never returned by the backend for the roster; the :id profile may carry a masked
// `peselLast4` for an HR/ADMIN_KLIENTA actor only (RODO — see employees.service.ts#getById). POST/PATCH
// are wired now so Tasks 3/4 (create/edit) need no proxy change, though nothing exercises them yet.
// See lib/tenant-runtime.ts.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('employees', path ?? []), search)
}

export const GET = handle
export const POST = handle
export const PATCH = handle
