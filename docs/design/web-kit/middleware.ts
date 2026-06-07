import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

const TENANT_PATHS = [
  '/dashboard',
  '/pracownicy',
  '/grafik',
  '/wnioski',
  '/dostepy',
  '/ustawienia',
]

/** Exported pure function for unit testing — no middleware coupling. */
export function isTenantRoute(pathname: string): boolean {
  return TENANT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
}

export default auth((req) => {
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
