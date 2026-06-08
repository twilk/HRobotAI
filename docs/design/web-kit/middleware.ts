import { auth } from '@/lib/auth'
import { type NextRequest, NextResponse } from 'next/server'

const TENANT_PATHS = [
  '/dashboard',
  '/pracownicy',
  '/grafik',
  '/wnioski',
  '/dostepy',
  '/ustawienia',
  '/raporty',
]

/** Exported pure function for unit testing — no middleware coupling. */
export function isTenantRoute(pathname: string): boolean {
  return TENANT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
}

const DEV_BYPASS =
  process.env.NODE_ENV === 'development' &&
  process.env.HROBOT_DEV_AUTH_BYPASS === '1'

/** Dev-only bypass: pass tenant slug header without any auth check. */
function devMiddleware(req: NextRequest) {
  const host = req.headers.get('host') ?? 'localhost'
  const slug = host.split('.')[0]
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-tenant-slug', slug)
  requestHeaders.set('x-user-roles', JSON.stringify(['ADMIN_KLIENTA']))
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export default DEV_BYPASS
  ? devMiddleware
  : auth((req) => {
      const { pathname } = req.nextUrl

      if (isTenantRoute(pathname) && !req.auth) {
        const url = req.nextUrl.clone()
        url.pathname = '/login'
        url.searchParams.set('callbackUrl', pathname)
        return NextResponse.redirect(url)
      }

      const host = req.headers.get('host') ?? 'localhost'
      const slug = host.split('.')[0]

      const requestHeaders = new Headers(req.headers)
      requestHeaders.set('x-tenant-slug', slug)

      if (req.auth?.user?.roles?.length) {
        requestHeaders.set('x-user-roles', JSON.stringify(req.auth.user.roles))
      }

      return NextResponse.next({ request: { headers: requestHeaders } })
    })

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
}
