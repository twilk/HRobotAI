# QA sweep — 3 role × ekrany: findings + fix spec (2026-07-12)

**Kontekst:** przegląd demo M2 (4Mobility) z 3 kont (`demo`/ADMIN_KLIENTA, `manager.demo`/MANAGER, `pracownik.demo`/PRACOWNIK) na każdym ekranie. Login zweryfikowany: wszystkie 3 konta logują się (realm `hrobot-staging`, klient `hrobot-web`, direct-grant). Poniżej findings z root-cause i planem naprawy.

## F1 — Przeciek tożsamości: strony-stuby pokazują „Jan Kowalski / ADMIN KLIENTA" każdemu (HIGH, zgłoszone przez użytkownika)

**Objaw:** zalogowany jako `pracownik.demo` (Anna) lub `manager.demo` (Marek) → klik **Wnioski** → topbar pokazuje „Jan Kowalski / ADMIN KLIENTA", a nawigacja pokazuje sekcję **ADMINISTRACJA** (Ustawienia, Użytkownicy). To samo na **Dostępy** i **Ustawienia**.

**Root cause:** `components/stub-screen.tsx` ma zaszyte na stałe:
```ts
const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
const roles: Role[] = ['ADMIN_KLIENTA']
```
Strony `wnioski/`, `dostepy/`, `ustawienia/` używają `StubScreen` i NIE wołają `getSession()` (w odróżnieniu od dashboard/grafik/pracownicy/zamiany). Każdy stub renderuje więc tożsamość i nawigację admina, niezależnie od zalogowanego użytkownika — realny przeciek RBAC/tożsamości na demo.

**Fix:** `StubScreen` → async server component wołający `getSession()` i wyliczający `user`/`roles` z sesji (jak `grafik/page.tsx`). Fallback dla braku sesji. Naprawia wszystkie 3 stuby naraz.

## F2 — `POST /grafik/solve` → 500 (HIGH — psuje rdzeń demo J2/J3)

**Objaw:** klik **„Generuj grafik"** → 500. Log: `Invalid prisma.shift.deleteMany() … Foreign key constraint violated: shift_swap_requests_requester_shift_id_fkey`.

**Root cause:** `grafik.service.ts` `solveGrafik` (txn) usuwa poprzednie AUTO-zmiany w zakresie (`tx.shift.deleteMany({source:'AUTO', …})`) PRZED wstawieniem nowych. Część usuwanych zmian jest referowana przez `shift_swap_requests` (requester/target_shift_id, FK RESTRICT) → naruszenie FK → 500. Dotyczy każdego re-solve tygodnia, w którym istnieje wniosek o zamianę na te zmiany (m.in. seed demo `a1b2c3d4`).

**Fix:** w tej samej transakcji, przed usunięciem zmian: pobrać id zmian do usunięcia, usunąć `shiftSwapRequest` referujące te id (OR requester/target), potem usunąć zmiany. Re-solve staje się idempotentny i nie crashuje. (Semantyka: regeneracja grafiku unieważnia oczekujące zamiany na regenerowanych zmianach — akceptowalne w M2; alternatywa schematowa `onDelete: Cascade` udokumentowana jako opcja.) Uwaga demo: po „Generuj grafik" seed zamiany trzeba odtworzyć (choreografia J2 przed J5).

## F3 — 401 „Unauthorized" na tenant-runtime po pewnym czasie / na starych sesjach (MED)

**Objaw:** `manager.demo` na **Zamiany** → „Utwórz przykładową" → `{"message":"Unauthorized","statusCode":401}`, listy puste. `grafik-screen` pokazuje „Brak autoryzacji do tenant-runtime…".

**Root cause (dwa czynniki):** (1) tokeny mintowane PRZED ustawieniem `frontendUrl` realmu miały `iss=http://localhost:8081`, który `KeycloakJwtStrategy.isTrustedIssuer` odrzuca (wymaga `http://keycloak:8080`) → 401. Naprawione dla NOWYCH logowań ustawieniem `frontendUrl` (poprzedni etap). (2) `auth-actions` zapisuje cookie z `maxAge = expires_in` (=`accessTokenLifespan` 300 s) i bez refresh-tokena → po 5 min sesja wygasa (re-gate na /login). Ryzyko wygaśnięcia w trakcie demo.

**Fix:** podnieść `accessTokenLifespan` realmu `hrobot-staging` do 3600 s (1 h) w `scripts/seed-keycloak-demo.mjs` + zastosować na żywym realmie. (Refresh-token rotation = M3.) Zweryfikować świeżym tokenem: POST create zamiany zwraca 2xx.

## Plan (bite-sized)
1. `stub-screen.tsx` → async + `getSession`, wylicz `user`/`roles`/`canManage`-nieistotne; zachowaj sygnaturę props. **Test:** login pracownik → /wnioski pokazuje „Anna Kowalska / PRACOWNIK", brak sekcji ADMINISTRACJA.
2. `grafik.service.ts` solve txn: delete dependent `shiftSwapRequest` przed `shift.deleteMany`. **Test:** POST /grafik/solve (admin) → 200; ponowny solve → 200 (idempotentny).
3. `seed-keycloak-demo.mjs`: `accessTokenLifespan: 3600`; PUT na realm. **Test:** świeży token manager → POST /shift-swap create → 2xx.
4. Deploy: rebuild `tenant-runtime` (F2), restart web-kit (F1), PUT realm lifespan (F3). Sweep 3×ekrany w przeglądarce.
