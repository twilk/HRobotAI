import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { apiRequestIsAllowed, isApiPath } from '@/lib/api-gate'

// Session gate for BOTH halves of the app:
//
//  - TENANT SCREENS (/dashboard, /grafik, …): no `hrobot_token` cookie → redirect to /login.
//  - THE BFF (/api/**): no caller credential → 401 JSON, and the request never reaches the route
//    handler. A redirect would be wrong here — an XHR/fetch caller needs a status, not an HTML login
//    page — so the two halves answer differently even though the precondition is the same.
//
// WHY /api HAD TO BE ADDED. Until this change the matcher was a page-prefix list with no /api entry,
// and NOT ONE of the 17 route handlers under app/api/ checked a session. Those handlers proxy to
// tenant-runtime through lib/tenant-runtime.ts, whose token chain ends in AMBIENT service credentials
// (a minted Keycloak token, then TENANT_RUNTIME_DEV_TOKEN). So an anonymous request did not merely
// reach the backend — the BFF attached its OWN service token and fetched tenant data on the
// anonymous caller's behalf.
//
// Reproduced against the LIVE stack, no cookie and no Authorization header:
//   GET /api/employees                       -> 200, 11157 B, 39 employee records (firstName/lastName)
//   GET /api/analityk?od=…&do=…              -> 200,  7575 B, tenant-wide HR aggregates
//   GET /api/dokumenty | /wnioski | /uzytkownicy -> 200, all with real records
//   GET :3001/api/employees (backend direct) -> 401  ← the backend defends itself correctly
//   GET /analiza (the screen for that data)  -> 307 -> /login
// The backend was never the weak point; the BFF was handing out its own credential. In an HR system
// these are personal data, and the dev server binds 0.0.0.0, so the reach was the local network —
// not just localhost.
//
// A NOTE ON DIAGNOSING THIS. An earlier probe of the same box saw 401 on these routes and read it as
// "the gap is latent". It was not: the server had inherited KEYCLOAK_CLIENT_ID=admin-cli from the
// shell, Next.js does not let .env.local override a real env var, and tenant-runtime rejected the
// resulting token on `azp`. That 401 came from the BACKEND, passed through by the proxy — it was
// never an access-control decision by this layer. Launched via start-live.mjs (which forces
// KEYCLOAK_CLIENT_ID=hrobot-web) the same requests returned data. Whether an anonymous request gets
// data has always depended only on whether the fallback can obtain a token the backend accepts,
// which is exactly why the gate cannot live in the token chain.
//
// The public exemptions and the credential rule live in lib/api-gate.ts — one module, shared with
// the proxy, so the gate and the token resolver cannot drift apart. lib/api-gate.test.ts holds the
// parity guard that keeps new routes closed by default.
//
// The cookie name is inlined below rather than imported from lib/session so this stays in the
// lightweight edge-middleware bundle (lib/session imports next/headers). lib/api-gate.ts is
// dependency-free for the same reason.
const SESSION_COOKIE = 'hrobot_token'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isApiPath(pathname)) {
    if (apiRequestIsAllowed(pathname, req)) return NextResponse.next()
    return NextResponse.json(
      {
        error: 'unauthenticated',
        message: 'Ta trasa wymaga sesji. Zaloguj się albo prześlij nagłówek Authorization.',
      },
      { status: 401 },
    )
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

// Tenant screens + the whole BFF surface. Keeping an explicit list for the SCREENS (rather than a
// broad negative lookahead) means marketing + assets never hit this middleware; `/api/:path*` is a
// single catch-all because the correct default for a BFF route is "closed", with exemptions named in
// lib/api-gate.ts PUBLICZNE_API rather than by omission from this list.
export const config = {
  matcher: [
    // The BFF. `:path*` also matches the bare `/api`. Every route under app/api/ is gated unless it
    // appears in PUBLICZNE_API (lib/api-gate.ts) — currently only the three pre-authentication
    // signup mocks, which reach no backend and touch no personal data.
    '/api/:path*',
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
    // Analityk HR (M3) — agregaty kadrowe najemcy (absencje, rotacja, czas pracy, anomalie).
    // ODRĘBNY ekran od /analiza (Strategiczny mózg: oceny, retencja, rekomendacje rekrutacyjne) —
    // podobne nazwy, różne dane i różne RBAC: /analityk odmawia PRACOWNIKOWI, /analiza pokazuje mu
    // własną kartę. Scalanie gałęzi zgubiło ten ekran po cichu (patrz commit scalający), więc wpis
    // wyglądał na osierocony; jest prawidłowy.
    '/analityk/:path*',
    // Profil pracownika — dane osobowe zalogowanego (imię, nazwisko, jednostka, historia zmian).
    // Ekran powstał na gałęzi produktowej JUŻ PO tym, jak gałąź integracyjna zamknęła trzy luki M3,
    // więc nie było go w żadnym z tamtych przeglądów i wszedł tu z tą samą wadą: renderował pełny
    // AppShell anonimowi. Wykryte przez strażnika parytetu w lib/middleware-matcher.test.ts przy
    // scalaniu obu gałęzi — dokładnie ten scenariusz, dla którego strażnik powstał.
    '/profil/:path*',
  ],
}
