// REAL proxy for the UŻYTKOWNICY (user invites + RBAC role management) endpoints:
// /api/uzytkownicy[/<x>] → ${TENANT_RUNTIME_URL}/uzytkownicy[/<x>]. Mirrors app/api/employees and
// app/api/ai-grafik (OPTIONAL catch-all so the bare `/api/uzytkownicy` roster route and the
// `/:userId/roles` + `/:userId/deactivate` sub-routes share one handler). Unlike those two, this
// module also needs DELETE — `DELETE /uzytkownicy/:userId/roles` (revoke, with `{role, unitId}` as
// the request BODY per `UsersController.revokeRole`) — so all four verbs are wired here. See
// lib/tenant-runtime.ts; lib/uzytkownicy.ts is the client that talks to this proxy.

import { joinBackendPath, proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  const search = new URL(req.url).search
  return proxyToTenantRuntime(req, joinBackendPath('uzytkownicy', path ?? []), search)
}

export const GET = handle
export const POST = handle
export const DELETE = handle
