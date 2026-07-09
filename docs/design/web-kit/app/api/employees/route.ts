// REAL proxy for the roster: /api/employees → ${TENANT_RUNTIME_URL}/employees. The grafik grid
// needs employee names to label rows/chips (the API returns UUIDs on shifts). PESEL/email are
// never returned by the backend (RODO). See lib/tenant-runtime.ts.

import { proxyToTenantRuntime } from '@/lib/tenant-runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  return proxyToTenantRuntime(req, 'employees')
}
