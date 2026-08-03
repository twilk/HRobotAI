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
    // Moduł Dokumenty (M3). A PRACOWNIK legitimately reaches this route for their own ewidencja
    // (app/(tenant)/dokumenty/page.tsx renders a read-only branch), but "logged in as somebody" is
    // still the precondition — without the cookie the page rendered the full AppShell for an
    // ANONYMOUS visitor while every sibling tenant route redirected to /login.
    '/dokumenty/:path*',
    // Analityk HR (M3) — agregaty kadrowe całego najemcy. Ekran był osierocony: brak w nav.ts i brak
    // tutaj, więc odpowiadał 200 anonimowi.
    '/analiza/:path*',
    // Agent Głosowy (M3) — wykonuje akcje na danych najemcy (wnioski, grafik) w imieniu zalogowanego.
    '/asystent/:path*',
    '/ustawienia/:path*',
    '/analityk/:path*',
  ],
}
