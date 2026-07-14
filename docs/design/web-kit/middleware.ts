import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Gate the (tenant) route group: any request to a tenant screen without an `hrobot_token` cookie is
// redirected to /login. The marketing group (/, /login, /signup), API routes, and static assets are
// left public (they're excluded by the matcher below). The cookie name is inlined rather than imported
// from lib/session so this stays in the lightweight edge-middleware bundle (no next/headers import).
const SESSION_COOKIE = 'hrobot_token'

export function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

// Only the tenant screens are protected. Keeping an explicit list (rather than a broad negative
// lookahead) means marketing + API + assets never hit this middleware.
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/pracownicy/:path*',
    '/grafik/:path*',
    '/ai-grafik-manager/:path*',
    '/zamiany/:path*',
    '/wnioski/:path*',
    '/dostepy/:path*',
    '/ustawienia/:path*',
  ],
}
